import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createSign } from 'crypto';
import type { AuthContext } from '../auth/types';
import { GitHubAppRepository } from './github-app.repository';
import { type GitHubAppConfig, isGitHubAppConfigured } from '../config/github-app.config';
import type {
  GitHubInstallation,
  GitHubRepo,
  TriggerRule,
  GitHubScanResult,
  CreateTriggerRuleInput,
  UpdateTriggerRuleInput,
  GitHubWebhookEvent,
  GitHubPullRequestEvent,
  GitHubPushEvent,
} from './dto/github-app.dto';
import { WorkflowsService } from '../workflows/workflows.service';

interface InstallationTokenCache {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class GitHubAppService implements OnModuleInit {
  private readonly logger = new Logger(GitHubAppService.name);
  private config: GitHubAppConfig;
  private installationTokenCache = new Map<number, InstallationTokenCache>();

  constructor(
    private readonly configService: ConfigService,
    private readonly repository: GitHubAppRepository,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflowsService: WorkflowsService,
  ) {
    this.config = this.configService.get<GitHubAppConfig>('githubApp')!;
  }

  async onModuleInit(): Promise<void> {
    if (isGitHubAppConfigured(this.config)) {
      this.logger.log('GitHub App is configured and ready');
    } else {
      this.logger.warn(
        'GitHub App is not fully configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.',
      );
    }
  }

  // ============ Webhook Auth Resolution ============

  /**
   * Resolve an AuthContext from a GitHub installation ID for webhook handling.
   * Returns null if the installation is not found in our database (e.g. for
   * brand-new installations that haven't been set up yet).
   */
  async resolveWebhookAuth(githubInstallationId: number): Promise<AuthContext | null> {
    const installation = await this.repository.findInstallationByGitHubId(githubInstallationId);
    if (!installation || !installation.organizationId) {
      return null;
    }
    return {
      userId: null,
      organizationId: installation.organizationId,
      roles: [],
      isAuthenticated: false,
      provider: 'github-webhook',
    };
  }

  // ============ Configuration ============

  isConfigured(): boolean {
    return isGitHubAppConfigured(this.config);
  }

  getInstallUrl(): string {
    if (!this.config.appId) {
      throw new BadRequestException('GitHub App is not configured');
    }
    const slug = this.config.slug;
    if (!slug) {
      throw new BadRequestException('GitHub App slug is not configured. Set GITHUB_APP_SLUG.');
    }
    return `${this.config.baseUrl}/apps/${slug}/installations/new`;
  }

  // ============ JWT Authentication ============

  /**
   * Generate a JWT for authenticating as the GitHub App
   * JWTs are valid for 10 minutes
   */
  private generateAppJwt(): string {
    if (!this.config.appId || !this.config.privateKey) {
      throw new BadRequestException('GitHub App is not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued 60 seconds ago to account for clock drift
      exp: now + 600, // Expires in 10 minutes
      iss: this.config.appId,
    };

    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));

    const privateKey = createPrivateKey(this.config.privateKey);
    const sign = createSign('RSA-SHA256');
    sign.update(`${encodedHeader}.${encodedPayload}`);
    const signature = sign.sign(privateKey, 'base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private base64UrlEncode(data: string): string {
    return Buffer.from(data).toString('base64url');
  }

  // ============ Installation Token ============

  /**
   * Get an installation access token for making API calls on behalf of an installation
   * Tokens are cached and automatically refreshed before expiry
   */
  async getInstallationToken(
    installationId: number,
    options?: { forceRefresh?: boolean },
  ): Promise<string> {
    if (options?.forceRefresh) {
      this.installationTokenCache.delete(installationId);
    }

    const cached = this.installationTokenCache.get(installationId);
    if (cached && cached.expiresAt > new Date(Date.now() + 60000)) {
      return cached.token;
    }

    const jwt = this.generateAppJwt();
    const response = await fetch(
      `${this.config.apiBaseUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to get installation token: ${error}`);
      throw new BadRequestException('Failed to authenticate with GitHub');
    }

    const data = (await response.json()) as { token: string; expires_at: string };
    const token = data.token;
    const expiresAt = new Date(data.expires_at);

    this.installationTokenCache.set(installationId, { token, expiresAt });
    return token;
  }

  /**
   * Get an installation token after verifying the installation belongs to the
   * caller's organization. Prevents cross-tenant token access.
   */
  async getInstallationTokenForOrg(installationId: number, auth: AuthContext): Promise<string> {
    const organizationId = this.requireOrganizationId(auth);
    const installation = await this.repository.findInstallationByGitHubId(installationId);

    if (!installation || installation.organizationId !== organizationId) {
      throw new NotFoundException('Installation not found');
    }

    return this.getInstallationToken(installationId);
  }

  /**
   * Resolve an installation token from a repository full name (owner/repo).
   * Looks up the repository record, finds the associated installation,
   * and returns the token + GitHub installation ID.
   */
  // ============ GitHub API Helpers ============

  private async githubApiRequest<T>(
    installationId: number,
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const token = await this.getInstallationToken(installationId);
    const url = endpoint.startsWith('http') ? endpoint : `${this.config.apiBaseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`GitHub API error (${response.status}): ${error}`);
      throw new BadRequestException(`GitHub API error: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // ============ Installation Management ============

  /**
   * Setup a GitHub App installation after the user is redirected back from GitHub.
   * If the installation already exists (webhook arrived first), returns it.
   * Otherwise, fetches the installation details from GitHub API and creates it.
   */
  async setupInstallation(
    githubInstallationId: number,
    auth: AuthContext,
  ): Promise<GitHubInstallation> {
    const organizationId = this.requireOrganizationId(auth);

    // Check if already exists (webhook may have arrived first)
    const existing = await this.repository.findInstallationByGitHubId(githubInstallationId);
    if (existing) {
      this.logger.log(
        `Installation ${githubInstallationId} already exists, ensuring repos are synced`,
      );
      // Ensure repos are synced even if the installation exists
      await this.syncInstallationRepositories(
        existing.id,
        githubInstallationId,
        existing.organizationId,
      );
      return this.mapInstallation(existing);
    }

    // Fetch installation details from GitHub API using App JWT
    const jwt = this.generateAppJwt();
    const response = await fetch(
      `${this.config.apiBaseUrl}/app/installations/${githubInstallationId}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(
        `Failed to fetch installation ${githubInstallationId} from GitHub: ${error}`,
      );
      throw new BadRequestException('Failed to fetch installation from GitHub');
    }

    const installationData = (await response.json()) as {
      id: number;
      account: {
        type: string;
        login: string;
        id: number;
        avatar_url: string;
      };
      repository_selection: string;
      permissions: Record<string, string>;
    };

    // Create installation record
    const record = await this.repository.createInstallation({
      installationId: githubInstallationId,
      accountType: installationData.account.type,
      accountLogin: installationData.account.login,
      accountId: installationData.account.id,
      accountAvatarUrl: installationData.account.avatar_url,
      repositorySelection: installationData.repository_selection,
      permissions: installationData.permissions,
      organizationId,
      installedBy: auth.userId,
      isActive: true,
    });

    this.logger.log(
      `Created installation ${githubInstallationId} for ${installationData.account.login} via setup callback`,
    );

    // Sync repositories
    await this.syncInstallationRepositories(record.id, githubInstallationId, organizationId);

    return this.mapInstallation(record);
  }

  async listInstallations(auth: AuthContext): Promise<GitHubInstallation[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.listInstallationsByOrg(organizationId);

    return records.map((r) => ({
      id: r.id,
      installationId: r.installationId,
      accountType: r.accountType as 'Organization' | 'User',
      accountLogin: r.accountLogin,
      accountId: r.accountId,
      accountAvatarUrl: r.accountAvatarUrl,
      repositorySelection: r.repositorySelection as 'all' | 'selected' | null,
      isActive: r.isActive,
      organizationId: r.organizationId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async handleInstallationCreated(
    event: GitHubWebhookEvent,
    auth: AuthContext,
  ): Promise<GitHubInstallation> {
    const organizationId = this.requireOrganizationId(auth);

    if (!event.installation) {
      throw new BadRequestException('Invalid installation event');
    }

    const { installation } = event;

    // Check if installation already exists
    const existing = await this.repository.findInstallationByGitHubId(installation.id);
    if (existing) {
      // Update existing installation
      const updated = await this.repository.updateInstallation(existing.id, {
        accountType: installation.account.type,
        accountLogin: installation.account.login,
        accountId: installation.account.id,
        accountAvatarUrl: installation.account.avatar_url,
        repositorySelection: installation.repository_selection,
        permissions: installation.permissions,
        isActive: true,
        suspendedAt: null,
      });
      return this.mapInstallation(updated!);
    }

    // Create new installation
    const record = await this.repository.createInstallation({
      installationId: installation.id,
      accountType: installation.account.type,
      accountLogin: installation.account.login,
      accountId: installation.account.id,
      accountAvatarUrl: installation.account.avatar_url,
      repositorySelection: installation.repository_selection,
      permissions: installation.permissions,
      organizationId,
      installedBy: event.sender?.login ?? auth.userId,
      isActive: true,
    });

    this.logger.log(
      `Created GitHub installation ${installation.id} for ${installation.account.login}`,
    );

    // Sync repositories for this installation
    await this.syncInstallationRepositories(record.id, installation.id, organizationId);

    return this.mapInstallation(record);
  }

  async handleInstallationDeleted(event: GitHubWebhookEvent): Promise<void> {
    if (!event.installation) return;

    await this.repository.deactivateInstallation(event.installation.id);
    this.installationTokenCache.delete(event.installation.id);
    this.logger.log(`Deactivated GitHub installation ${event.installation.id}`);
  }

  async handleInstallationSuspended(event: GitHubWebhookEvent): Promise<void> {
    if (!event.installation) return;

    const existing = await this.repository.findInstallationByGitHubId(event.installation.id);
    if (existing) {
      await this.repository.updateInstallation(existing.id, {
        suspendedAt: new Date(),
      });
    }
    this.logger.log(`Suspended GitHub installation ${event.installation.id}`);
  }

  async handleInstallationUnsuspended(event: GitHubWebhookEvent): Promise<void> {
    if (!event.installation) return;

    const existing = await this.repository.findInstallationByGitHubId(event.installation.id);
    if (existing) {
      await this.repository.updateInstallation(existing.id, {
        suspendedAt: null,
        isActive: true,
      });
    }
    this.logger.log(`Unsuspended GitHub installation ${event.installation.id}`);
  }

  async handleRepositoriesAdded(
    event: GitHubWebhookEvent,
    auth: AuthContext,
  ): Promise<{ status: string; scansTriggered?: number }> {
    if (!event.installation || !event.repositories_added) {
      return { status: 'ignored', scansTriggered: 0 };
    }

    // Installation tokens are scoped to selected repositories at creation time.
    // Invalidate cache so newly granted repositories are visible immediately.
    this.installationTokenCache.delete(event.installation.id);

    const organizationId = this.requireOrganizationId(auth);
    const installation = await this.repository.findInstallationByGitHubId(event.installation.id);
    if (!installation) {
      return { status: 'installation_not_found', scansTriggered: 0 };
    }

    let scansTriggered = 0;

    for (const repo of event.repositories_added) {
      const repoRecord = await this.repository.upsertRepository({
        installationId: installation.id,
        repoId: repo.id,
        fullName: repo.full_name,
        name: repo.name,
        owner: repo.full_name.split('/')[0],
        isPrivate: repo.private,
        organizationId,
      });

      if (!repoRecord.scansEnabled) {
        this.logger.log(`Scans disabled for repository ${repo.full_name}, skipping`);
        continue;
      }

      const rules = await this.findMatchingTriggerRules(
        organizationId,
        'repository_added',
        repo.full_name,
      );

      for (const rule of rules) {
        try {
          const runHandle = await this.workflowsService.run(
            rule.workflowId,
            {
              inputs: {
                repository: repo.full_name,
                owner: repo.full_name.split('/')[0],
                repo: repo.full_name.split('/')[1],
                installationId: event.installation.id,
                repositoryId: repoRecord.id,
                postPrComment: rule.postPrComment,
                createCheckRun: rule.createCheckRun,
              },
            },
            auth,
            {
              trigger: {
                type: 'webhook',
                sourceId: repo.full_name,
                label: `Repository added: ${repo.full_name}`,
              },
              componentInputs: this.buildGitHubComponentInputs(event.installation.id),
              componentParams: {
                'github.repo.clone': {
                  repository: repo.full_name,
                },
              },
            },
          );

          await this.repository.createScanResult({
            repositoryId: repoRecord.id,
            workflowRunId: runHandle.runId,
            sourceType: 'manual',
            status: 'running',
            summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
            findingsCount: 0,
            triggerRuleId: rule.id,
            organizationId,
            startedAt: new Date(),
          });

          scansTriggered++;
          this.logger.log(
            `Triggered scan for newly added repository ${repo.full_name} using rule ${rule.name} (workflow: ${runHandle.runId})`,
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to trigger scan for rule ${rule.name}: ${errorMessage}`);
        }
      }
    }

    this.logger.log(`Added ${event.repositories_added.length} repositories to installation`);
    return {
      status: scansTriggered > 0 ? 'scans_triggered' : 'repositories_added',
      scansTriggered,
    };
  }

  async handleRepositoriesRemoved(event: GitHubWebhookEvent): Promise<void> {
    if (!event.repositories_removed) return;

    if (event.installation) {
      this.installationTokenCache.delete(event.installation.id);
    }

    const repoIds = event.repositories_removed.map((r) => r.id);
    await this.repository.deleteRepositoriesByGitHubIds(repoIds);

    this.logger.log(`Removed ${repoIds.length} repositories from installation`);
  }

  // ============ Repository Management ============

  async syncInstallationRepositories(
    installationRecordId: string,
    githubInstallationId: number,
    organizationId: string,
    options?: { forceRefreshToken?: boolean },
  ): Promise<number> {
    try {
      if (options?.forceRefreshToken) {
        this.installationTokenCache.delete(githubInstallationId);
      }

      interface GitHubRepoResponse {
        id: number;
        name: string;
        full_name: string;
        private: boolean;
        default_branch: string;
        description: string | null;
        language: string | null;
        clone_url: string;
        html_url: string;
        owner: { login: string };
      }

      interface GitHubReposResponse {
        total_count: number;
        repositories: GitHubRepoResponse[];
      }

      let allRepos: GitHubRepoResponse[] = [];
      let page = 1;
      const perPage = 100;
      let hasMore = true;

      // Paginate through all repositories
      while (hasMore) {
        const response = await this.githubApiRequest<GitHubReposResponse>(
          githubInstallationId,
          `/installation/repositories?per_page=${perPage}&page=${page}`,
        );

        allRepos = allRepos.concat(response.repositories);

        // Check if there are more pages
        hasMore =
          response.repositories.length === perPage && allRepos.length < response.total_count;
        page++;
      }

      // Upsert all repositories with sync timestamp
      const syncTimestamp = new Date();
      for (const repo of allRepos) {
        await this.repository.upsertRepository({
          installationId: installationRecordId,
          repoId: repo.id,
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
          isPrivate: repo.private,
          defaultBranch: repo.default_branch,
          description: repo.description,
          language: repo.language,
          cloneUrl: repo.clone_url,
          htmlUrl: repo.html_url,
          organizationId,
          lastSyncedAt: syncTimestamp,
        });
      }

      this.logger.log(
        `Synced ${allRepos.length} repositories for installation ${githubInstallationId}`,
      );
      return allRepos.length;
    } catch (error) {
      this.logger.error(`Failed to sync repositories: ${error}`);
      return 0;
    }
  }

  async listRepositories(auth: AuthContext): Promise<GitHubRepo[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.listRepositoriesByOrg(organizationId);

    return records.map((r) => ({
      id: r.id,
      installationId: r.installationId,
      repoId: r.repoId,
      fullName: r.fullName,
      name: r.name,
      owner: r.owner,
      isPrivate: r.isPrivate,
      defaultBranch: r.defaultBranch,
      description: r.description,
      language: r.language,
      htmlUrl: r.htmlUrl,
      scansEnabled: r.scansEnabled,
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async getRepository(id: string, auth: AuthContext): Promise<GitHubRepo> {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findRepositoryById(id);

    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    return {
      id: record.id,
      installationId: record.installationId,
      repoId: record.repoId,
      fullName: record.fullName,
      name: record.name,
      owner: record.owner,
      isPrivate: record.isPrivate,
      defaultBranch: record.defaultBranch,
      description: record.description,
      language: record.language,
      htmlUrl: record.htmlUrl,
      scansEnabled: record.scansEnabled,
      lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async toggleRepoScans(id: string, enabled: boolean, auth: AuthContext): Promise<GitHubRepo> {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findRepositoryById(id);

    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    const updated = await this.repository.updateRepository(id, { scansEnabled: enabled });
    return this.mapRepository(updated!);
  }

  async listBranches(
    id: string,
    auth: AuthContext,
  ): Promise<{ name: string; isDefault: boolean }[]> {
    const organizationId = this.requireOrganizationId(auth);
    const repo = await this.repository.findRepositoryById(id);

    if (!repo || repo.organizationId !== organizationId) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    const installation = await this.repository.findInstallationById(repo.installationId);
    if (!installation) {
      throw new BadRequestException('Repository installation not found');
    }

    const allBranches: { name: string }[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const pageBranches = await this.githubApiRequest<{ name: string }[]>(
        installation.installationId,
        `/repos/${repo.fullName}/branches?per_page=${perPage}&page=${page}`,
      );
      allBranches.push(...pageBranches);
      hasMore = pageBranches.length === perPage;
      page++;
    }

    return allBranches.map((b) => ({
      name: b.name,
      isDefault: b.name === repo.defaultBranch,
    }));
  }

  // ============ Trigger Rules ============

  async listTriggerRules(auth: AuthContext): Promise<TriggerRule[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.listTriggerRulesByOrg(organizationId);
    return records.map((r) => this.mapTriggerRule(r));
  }

  async getTriggerRule(id: string, auth: AuthContext): Promise<TriggerRule> {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findTriggerRuleById(id);

    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundException(`Trigger rule ${id} not found`);
    }

    return this.mapTriggerRule(record);
  }

  async createTriggerRule(input: CreateTriggerRuleInput, auth: AuthContext): Promise<TriggerRule> {
    const organizationId = this.requireOrganizationId(auth);

    const record = await this.repository.createTriggerRule({
      name: input.name,
      description: input.description ?? null,
      repositoryPattern: input.repositoryPattern,
      event: input.event,
      actions: input.actions ?? [],
      branches: input.branches ?? [],
      workflowId: input.workflowId,
      postPrComment: input.postPrComment ?? true,
      createCheckRun: input.createCheckRun ?? true,
      postPrReview: input.postPrReview ?? false,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 100,
      organizationId,
      createdBy: auth.userId,
    });

    this.logger.log(`Created trigger rule ${record.id}: ${record.name}`);
    return this.mapTriggerRule(record);
  }

  async updateTriggerRule(
    id: string,
    input: UpdateTriggerRuleInput,
    auth: AuthContext,
  ): Promise<TriggerRule> {
    const organizationId = this.requireOrganizationId(auth);
    const existing = await this.repository.findTriggerRuleById(id);

    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException(`Trigger rule ${id} not found`);
    }

    const updated = await this.repository.updateTriggerRule(id, {
      name: input.name,
      description: input.description,
      repositoryPattern: input.repositoryPattern,
      event: input.event,
      actions: input.actions,
      branches: input.branches,
      workflowId: input.workflowId,
      postPrComment: input.postPrComment,
      createCheckRun: input.createCheckRun,
      postPrReview: input.postPrReview,
      enabled: input.enabled,
      priority: input.priority,
    });

    return this.mapTriggerRule(updated!);
  }

  async deleteTriggerRule(id: string, auth: AuthContext): Promise<void> {
    const organizationId = this.requireOrganizationId(auth);
    const existing = await this.repository.findTriggerRuleById(id);

    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException(`Trigger rule ${id} not found`);
    }

    await this.repository.deleteTriggerRule(id);
    this.logger.log(`Soft-deleted trigger rule ${id}`);
  }

  // ============ PR/Push Event Handling ============

  async findMatchingTriggerRules(
    organizationId: string,
    event: string,
    repoFullName: string,
    action?: string,
    branch?: string,
  ): Promise<TriggerRule[]> {
    const rules = await this.repository.findMatchingTriggerRules(
      organizationId,
      event,
      repoFullName,
    );

    return rules
      .filter((rule) => {
        // Filter by action if specified
        if (action && rule.actions && rule.actions.length > 0) {
          if (!rule.actions.includes(action)) return false;
        }

        // Filter by branch if specified
        if (branch && rule.branches && rule.branches.length > 0) {
          const branchMatches = rule.branches.some((pattern) => {
            if (pattern.endsWith('/*')) {
              return branch.startsWith(pattern.slice(0, -2));
            }
            return pattern === branch;
          });
          if (!branchMatches) return false;
        }

        return true;
      })
      .map((r) => this.mapTriggerRule(r));
  }

  /**
   * Handle pull_request webhook events.
   * Only processes: opened, synchronize, reopened actions.
   * Creates scan results and triggers workflows for each matching rule.
   */
  async handlePullRequestEvent(
    event: GitHubPullRequestEvent,
    auth: AuthContext,
  ): Promise<{ status: string; scansTriggered?: number }> {
    const { action, number, pull_request, repository, installation } = event;
    const organizationId = this.requireOrganizationId(auth);

    this.logger.log(`PR event: ${action} on ${repository.full_name}#${number}`);

    // Only process specific actions
    const processableActions = ['opened', 'synchronize', 'reopened'];
    if (!processableActions.includes(action)) {
      this.logger.log(`Ignoring PR action: ${action}`);
      return { status: 'ignored', scansTriggered: 0 };
    }

    if (!installation) {
      this.logger.warn('PR event without installation context');
      return { status: 'no_installation', scansTriggered: 0 };
    }

    // Find repository record by full_name
    const repoRecord = await this.repository.findRepositoryByFullName(repository.full_name);
    if (!repoRecord) {
      this.logger.warn(`Repository ${repository.full_name} not found in database`);
      return { status: 'repository_not_found', scansTriggered: 0 };
    }

    if (!repoRecord.scansEnabled) {
      this.logger.log(`Scans disabled for repository ${repository.full_name}, skipping`);
      return { status: 'scans_disabled', scansTriggered: 0 };
    }

    // Find matching trigger rules - use head.ref (source branch where changes are)
    const rules = await this.findMatchingTriggerRules(
      organizationId,
      'pull_request',
      repository.full_name,
      action,
      pull_request.head.ref,
    );

    if (rules.length === 0) {
      return { status: 'no_matching_rules', scansTriggered: 0 };
    }

    // Trigger workflows for each matching rule
    const owner = repository.full_name.split('/')[0];
    let scansTriggered = 0;
    for (const rule of rules) {
      try {
        // Build componentInputs with rule-scoped existingCommentId
        const componentInputs = this.buildGitHubComponentInputs(installation.id);

        // Look up existing PR comment for this rule to enable upsert
        if (rule.postPrComment) {
          try {
            const existingScan = await this.repository.findLatestScanResultCommentForRule(
              repoRecord.id,
              number,
              rule.id,
            );
            if (existingScan?.prCommentId) {
              componentInputs['github.pr.comment'] = {
                ...componentInputs['github.pr.comment'],
                existingCommentId: existingScan.prCommentId,
              };
            }
          } catch (err) {
            this.logger.warn(
              `Failed to lookup existing comment for rule ${rule.name}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }

        // Trigger workflow execution
        const runHandle = await this.workflowsService.run(
          rule.workflowId,
          {
            inputs: {
              repository: repository.full_name,
              owner,
              repo: repository.name,
              branch: pull_request.head.ref,
              ref: pull_request.head.sha,
              installationId: installation.id,
              repositoryId: repoRecord.id,
              prNumber: number,
              postPrComment: rule.postPrComment,
              createCheckRun: rule.createCheckRun,
              postPrReview: rule.postPrReview,
            },
          },
          auth,
          {
            trigger: {
              type: 'webhook',
              sourceId: `${repository.full_name}#${number}`,
              label: `PR #${number}: ${pull_request.title}`,
            },
            componentInputs,
            componentParams: {
              'github.repo.clone': {
                repository: repository.full_name,
                branch: pull_request.head.ref,
                ref: pull_request.head.sha,
              },
            },
          },
        );

        // Create scan result record first (always persisted)
        const scanResult = await this.repository.createScanResult({
          repositoryId: repoRecord.id,
          workflowRunId: runHandle.runId,
          sourceType: 'pr',
          prNumber: number,
          branch: pull_request.head.ref,
          commitSha: pull_request.head.sha,
          status: 'running',
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findingsCount: 0,
          triggerRuleId: rule.id,
          organizationId,
          startedAt: new Date(),
        });

        // Best-effort: create check run immediately so it shows as in_progress
        if (rule.createCheckRun) {
          try {
            const checkRun = await this.createCheckRun(installation.id, owner, repository.name, {
              name: rule.name,
              head_sha: pull_request.head.sha,
              status: 'in_progress',
            });
            await this.repository.updateScanResult(scanResult.id, {
              checkRunId: checkRun.id,
            });
          } catch (err) {
            this.logger.warn(
              `Failed to create check run for rule ${rule.name}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }

        scansTriggered++;
        this.logger.log(
          `Triggered scan for PR #${number} using rule ${rule.name} (workflow: ${runHandle.runId})`,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to trigger scan for rule ${rule.name}: ${errorMessage}`);
      }
    }

    return { status: 'scans_triggered', scansTriggered };
  }

  /**
   * Handle push webhook events.
   * Ignores tag pushes (refs/tags/*).
   * Creates scan results and triggers workflows for each matching rule.
   */
  async handlePushEvent(
    event: GitHubPushEvent,
    auth: AuthContext,
  ): Promise<{ status: string; scansTriggered?: number }> {
    const { ref, after, repository, installation } = event;
    const organizationId = this.requireOrganizationId(auth);

    // Parse branch name from ref
    if (ref.startsWith('refs/tags/')) {
      this.logger.log(`Ignoring tag push: ${ref}`);
      return { status: 'ignored_tag', scansTriggered: 0 };
    }

    const branch = ref.replace('refs/heads/', '');
    this.logger.log(`Push event on ${repository.full_name}:${branch}`);

    if (!installation) {
      this.logger.warn('Push event without installation context');
      return { status: 'no_installation', scansTriggered: 0 };
    }

    // Find repository record by full_name
    const repoRecord = await this.repository.findRepositoryByFullName(repository.full_name);
    if (!repoRecord) {
      this.logger.warn(`Repository ${repository.full_name} not found in database`);
      return { status: 'repository_not_found', scansTriggered: 0 };
    }

    if (!repoRecord.scansEnabled) {
      this.logger.log(`Scans disabled for repository ${repository.full_name}, skipping`);
      return { status: 'scans_disabled', scansTriggered: 0 };
    }

    // Find matching trigger rules
    const rules = await this.findMatchingTriggerRules(
      organizationId,
      'push',
      repository.full_name,
      undefined,
      branch,
    );

    if (rules.length === 0) {
      return { status: 'no_matching_rules', scansTriggered: 0 };
    }

    // Trigger workflows for each matching rule
    const pushOwner = repository.full_name.split('/')[0];
    let scansTriggered = 0;
    for (const rule of rules) {
      try {
        // Trigger workflow execution
        const runHandle = await this.workflowsService.run(
          rule.workflowId,
          {
            inputs: {
              repository: repository.full_name,
              owner: pushOwner,
              repo: repository.name,
              branch,
              ref: after,
              installationId: installation.id,
              repositoryId: repoRecord.id,
              postPrComment: rule.postPrComment,
              createCheckRun: rule.createCheckRun,
            },
          },
          auth,
          {
            trigger: {
              type: 'webhook',
              sourceId: `${repository.full_name}:${branch}`,
              label: `Push to ${branch}`,
            },
            componentInputs: this.buildGitHubComponentInputs(installation.id),
            componentParams: {
              'github.repo.clone': {
                repository: repository.full_name,
                branch,
                ref: after,
              },
            },
          },
        );

        // Create scan result record first (always persisted)
        const scanResult = await this.repository.createScanResult({
          repositoryId: repoRecord.id,
          workflowRunId: runHandle.runId,
          sourceType: 'push',
          branch,
          commitSha: after,
          status: 'running',
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findingsCount: 0,
          triggerRuleId: rule.id,
          organizationId,
          startedAt: new Date(),
        });

        // Best-effort: create check run immediately so it shows as in_progress
        if (rule.createCheckRun) {
          try {
            const checkRun = await this.createCheckRun(
              installation.id,
              pushOwner,
              repository.name,
              {
                name: rule.name,
                head_sha: after,
                status: 'in_progress',
              },
            );
            await this.repository.updateScanResult(scanResult.id, {
              checkRunId: checkRun.id,
            });
          } catch (err) {
            this.logger.warn(
              `Failed to create check run for rule ${rule.name}: ${err instanceof Error ? err.message : err}`,
            );
          }
        }

        scansTriggered++;
        this.logger.log(
          `Triggered scan for push to ${branch} using rule ${rule.name} (workflow: ${runHandle.runId})`,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to trigger scan for rule ${rule.name}: ${errorMessage}`);
      }
    }

    return { status: 'scans_triggered', scansTriggered };
  }

  // ============ Scan Results ============

  async listScanResults(
    auth: AuthContext,
    options?: {
      repositoryId?: string;
      limit?: number;
      offset?: number;
      statuses?: string[];
      source?: 'pr' | 'push' | 'manual' | 'schedule';
      scheduleId?: string;
      triggerRuleId?: string;
    },
  ): Promise<GitHubScanResult[]> {
    const organizationId = this.requireOrganizationId(auth);

    const records = await this.repository.listScanResultsByOrg(organizationId, {
      repositoryId: options?.repositoryId,
      limit: options?.limit,
      offset: options?.offset,
      statuses: options?.statuses,
      source: options?.source,
      scheduleId: options?.scheduleId,
      triggerRuleId: options?.triggerRuleId,
    });

    return records.map((r) => this.mapScanResult(r));
  }

  async getScanResult(id: string, auth: AuthContext): Promise<GitHubScanResult> {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findScanResultById(id);

    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundException(`Scan result ${id} not found`);
    }

    return this.mapScanResult(record);
  }

  /**
   * Trigger a manual scan on a repository.
   * Creates a scan result record and starts the workflow execution.
   */
  async triggerScan(
    repositoryId: string,
    workflowId: string,
    branch: string | undefined,
    auth: AuthContext,
  ): Promise<string> {
    const organizationId = this.requireOrganizationId(auth);

    // Fetch repository record and verify organization ownership
    const repository = await this.repository.findRepositoryById(repositoryId);
    if (!repository || repository.organizationId !== organizationId) {
      throw new NotFoundException(`Repository ${repositoryId} not found`);
    }

    // Get the installation record to get the GitHub installation ID
    const installation = await this.repository.findInstallationById(repository.installationId);
    if (!installation) {
      throw new BadRequestException('Repository installation not found');
    }

    // Use provided branch or fall back to default branch
    const targetBranch = branch || repository.defaultBranch || 'main';

    try {
      // Trigger workflow execution with GitHub repository inputs
      // We do this first to get the runId before creating the scan result
      const runHandle = await this.workflowsService.run(
        workflowId,
        {
          inputs: {
            repository: repository.fullName,
            owner: repository.owner,
            repo: repository.name,
            branch: targetBranch,
            installationId: installation.installationId,
            repositoryId: repository.id,
          },
        },
        auth,
        {
          trigger: {
            type: 'manual',
            sourceId: repository.fullName,
            label: `Manual scan: ${repository.fullName} (${targetBranch})`,
          },
          componentInputs: this.buildGitHubComponentInputs(installation.installationId),
          componentParams: {
            'github.repo.clone': {
              repository: repository.fullName,
              branch: targetBranch,
            },
          },
        },
      );

      // Create scan result record with workflow run ID, status='running', source_type='manual'
      const scanResult = await this.repository.createScanResult({
        repositoryId,
        workflowRunId: runHandle.runId,
        sourceType: 'manual',
        branch: targetBranch,
        status: 'running',
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        findingsCount: 0,
        organizationId,
        startedAt: new Date(),
      });

      this.logger.log(
        `Started scan ${scanResult.id} for repository ${repository.fullName} (branch: ${targetBranch}, workflowRunId: ${runHandle.runId})`,
      );

      return scanResult.id;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start scan workflow: ${errorMessage}`);
      throw error;
    }
  }

  // ============ GitHub API Operations ============

  async postPrComment(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<{ id: number }> {
    return this.githubApiRequest<{ id: number }>(
      installationId,
      `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
  }

  async getPullRequestFiles(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<{ filename: string; status: string; patch?: string }[]> {
    const files: { filename: string; status: string; patch?: string }[] = [];

    for (let page = 1; page <= 30; page++) {
      const pageFiles = await this.githubApiRequest<
        { filename: string; status: string; patch?: string }[]
      >(
        installationId,
        `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      );

      if (pageFiles.length === 0) break;
      files.push(...pageFiles);
      if (pageFiles.length < 100) break;
    }

    return files;
  }

  async createPullRequestReview(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
    data: {
      commit_id: string;
      body: string;
      event: 'COMMENT';
      comments: { path: string; line: number; side: 'RIGHT'; body: string }[];
    },
  ): Promise<{ id: number; html_url: string } | { status: 422; error: string }> {
    const token = await this.getInstallationToken(installationId);
    const url = `${this.config.apiBaseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      return (await response.json()) as { id: number; html_url: string };
    }

    const error = await response.text();
    const excerpt = error.length > 500 ? `${error.slice(0, 500)}...` : error;
    if (response.status === 422) {
      return { status: 422, error: excerpt };
    }

    this.logger.error(
      `GitHub review API error (${response.status}) for ${owner}/${repo}#${prNumber}: ${excerpt}`,
    );
    throw new BadRequestException(
      `GitHub review API error (${response.status}): ${response.statusText}`,
    );
  }

  async createCheckRun(
    installationId: number,
    owner: string,
    repo: string,
    data: {
      name: string;
      head_sha: string;
      status: 'queued' | 'in_progress' | 'completed';
      conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped';
      output?: {
        title: string;
        summary: string;
        text?: string;
        annotations?: {
          path: string;
          start_line: number;
          end_line: number;
          annotation_level: 'notice' | 'warning' | 'failure';
          message: string;
          title?: string;
        }[];
      };
    },
  ): Promise<{ id: number }> {
    return this.githubApiRequest<{ id: number }>(
      installationId,
      `/repos/${owner}/${repo}/check-runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
    );
  }

  async updateCheckRun(
    installationId: number,
    owner: string,
    repo: string,
    checkRunId: number,
    data: {
      status?: 'queued' | 'in_progress' | 'completed';
      conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped';
      output?: {
        title: string;
        summary: string;
        text?: string;
        annotations?: {
          path: string;
          start_line: number;
          end_line: number;
          annotation_level: 'notice' | 'warning' | 'failure';
          message: string;
          title?: string;
        }[];
      };
    },
  ): Promise<{ id: number }> {
    return this.githubApiRequest<{ id: number }>(
      installationId,
      `/repos/${owner}/${repo}/check-runs/${checkRunId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
    );
  }

  // ============ Helper Methods ============

  /**
   * Resolve the GitHub installation ID for a given repository full name.
   * Used by WorkflowsService to auto-inject installationId for manual runs.
   */
  async resolveInstallationForRepo(
    repoFullName: string,
  ): Promise<{ installationId: number } | null> {
    const repo = await this.repository.findRepositoryByFullName(repoFullName);
    if (!repo) {
      return null;
    }

    const installation = await this.repository.findInstallationById(repo.installationId);
    if (!installation) {
      return null;
    }

    return { installationId: installation.installationId };
  }

  /**
   * Build componentInputs map that injects installationId into all GitHub
   * worker components. This ensures the token is resolved server-side at
   * trigger time, not by the worker calling back to the backend.
   */
  private buildGitHubComponentInputs(
    installationId: number,
  ): Record<string, Record<string, unknown>> {
    const inputs = { installationId };
    return {
      'github.repo.clone': inputs,
      'github.pr.context': inputs,
      'github.pr.comment': inputs,
      'github.check.create': inputs,
      'github.check.update': inputs,
    };
  }

  private requireOrganizationId(auth: AuthContext | null): string {
    if (!auth?.organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return auth.organizationId;
  }

  private mapInstallation(record: any): GitHubInstallation {
    return {
      id: record.id,
      installationId: record.installationId,
      accountType: record.accountType,
      accountLogin: record.accountLogin,
      accountId: record.accountId,
      accountAvatarUrl: record.accountAvatarUrl,
      repositorySelection: record.repositorySelection,
      isActive: record.isActive,
      organizationId: record.organizationId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapRepository(record: any): GitHubRepo {
    return {
      id: record.id,
      installationId: record.installationId,
      repoId: record.repoId,
      fullName: record.fullName,
      name: record.name,
      owner: record.owner,
      isPrivate: record.isPrivate,
      defaultBranch: record.defaultBranch,
      description: record.description,
      language: record.language,
      htmlUrl: record.htmlUrl,
      scansEnabled: record.scansEnabled,
      lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapTriggerRule(record: any): TriggerRule {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      repositoryPattern: record.repositoryPattern,
      event: record.event,
      actions: record.actions ?? [],
      branches: record.branches ?? [],
      workflowId: record.workflowId,
      postPrComment: record.postPrComment,
      createCheckRun: record.createCheckRun,
      postPrReview: record.postPrReview,
      failOn: record.failOn,
      enabled: record.enabled,
      priority: record.priority,
      organizationId: record.organizationId,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapScanResult(record: any): GitHubScanResult {
    const triggerType = typeof record.triggerType === 'string' ? record.triggerType : null;
    const triggerSource = typeof record.triggerSource === 'string' ? record.triggerSource : null;
    const triggerLabel = typeof record.triggerLabel === 'string' ? record.triggerLabel : null;
    const isScheduleTriggered = triggerType === 'schedule';

    return {
      id: record.id,
      repositoryId: record.repositoryId,
      workflowRunId: record.workflowRunId,
      sourceType: isScheduleTriggered ? 'schedule' : record.sourceType,
      triggerType,
      triggerSource,
      triggerLabel,
      scheduleId: isScheduleTriggered ? triggerSource : null,
      scheduleName: isScheduleTriggered ? triggerLabel : null,
      prNumber: record.prNumber,
      branch: record.branch,
      commitSha: record.commitSha,
      status: record.status,
      summary: record.summary ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findingsCount: record.findingsCount,
      findings: record.findings ?? [],
      checkRunId: record.checkRunId,
      prCommentId: record.prCommentId,
      prReviewId: record.prReviewId ?? null,
      resultsUrl: record.resultsUrl,
      errorMessage: record.errorMessage,
      triggerRuleId: record.triggerRuleId,
      organizationId: record.organizationId,
      startedAt: record.startedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      workflowName: record.workflowName ?? null,
      workflowVersion: record.workflowVersion ?? null,
    };
  }
}
