import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from 'octokit';

/**
 * GitHub Service for Template operations
 * Handles PR creation, template fetching from GitHub repository
 */
@Injectable()
export class GitHubTemplateService {
  private readonly logger = new Logger(GitHubTemplateService.name);
  private readonly octokit: Octokit | null = null;
  private readonly templateRepo: string;
  private readonly templateBranch: string;

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('GITHUB_TEMPLATE_TOKEN');
    this.templateRepo = this.configService.get<string>('GITHUB_TEMPLATE_REPO', '');
    this.templateBranch = this.configService.get<string>('GITHUB_TEMPLATE_BRANCH', 'main');

    if (token) {
      this.octokit = new Octokit({ auth: token });
    }

    if (!this.templateRepo) {
      this.logger.warn('GITHUB_TEMPLATE_REPO not configured');
    }
  }

  /**
   * Check if GitHub integration is configured
   */
  isConfigured(): boolean {
    return !!this.octokit && !!this.templateRepo;
  }

  /**
   * Create a pull request with template content
   */
  async createTemplatePR(params: {
    templateName: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    manifest: Record<string, unknown>;
    graph: Record<string, unknown>;
    requiredSecrets: Array<{ name: string; type: string; description?: string; placeholder?: string }>;
  }): Promise<{ prNumber: number; prUrl: string; branch: string }> {
    if (!this.isConfigured()) {
      throw new Error('GitHub integration not configured');
    }

    const { templateName, description, category, tags, author, manifest, graph, requiredSecrets } = params;

    // Create branch name
    const timestamp = Date.now();
    const sanitizedName = templateName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const branchName = `template/${sanitizedName}-${timestamp}`;
    const baseBranch = this.templateBranch;

    try {
      // Get base commit SHA
      const { data: baseRef } = await this.octokit!.rest.git.getRef({
        owner: this.getRepoOwner(),
        repo: this.getRepoName(),
        ref: `heads/${baseBranch}`,
      });

      const baseSha = baseRef.object.sha;

      // Create new branch
      await this.octokit!.rest.git.createRef({
        owner: this.getRepoOwner(),
        repo: this.getRepoName(),
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });

      // Create template file
      const templatePath = `templates/${sanitizedName}.json`;
      const templateContent = {
        manifest,
        graph,
        requiredSecrets,
      };

      // Commit the template file
      await this.octokit!.rest.repos.createOrUpdateFileContents({
        owner: this.getRepoOwner(),
        repo: this.getRepoName(),
        path: templatePath,
        branch: branchName,
        content: Buffer.from(JSON.stringify(templateContent, null, 2)).toString('base64'),
        message: `feat: Add ${templateName} template`,
      });

      // Create pull request
      const { data: pr } = await this.octokit!.rest.pulls.create({
        owner: this.getRepoOwner(),
        repo: this.getRepoName(),
        title: `Add template: ${templateName}`,
        head: branchName,
        base: baseBranch,
        body: this.generatePRDescription({ templateName, description, category, tags, author }),
        labels: ['template', category],
      });

      this.logger.log(`Created PR #${pr.number} for template: ${templateName}`);

      return {
        prNumber: pr.number,
        prUrl: pr.html_url,
        branch: branchName,
      };
    } catch (error) {
      this.logger.error(`Failed to create template PR: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Get all templates from the repository
   */
  async getTemplatesFromRepo(): Promise<
    Array<{
      name: string;
      path: string;
      sha: string;
      content: Record<string, unknown>;
    }>
  > {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      // Get tree for templates directory
      const { data: tree } = await this.octokit!.rest.git.getTree({
        owner: this.getRepoOwner(),
        repo: this.getRepoName(),
        tree_sha: this.templateBranch,
        recursive: 'true',
      });

      const templateFiles = tree.tree
        .filter((item) => item.type === 'blob' && item.path?.startsWith('templates/'))
        .filter((item) => item.path?.endsWith('.json'));

      const templates = [];

      for (const file of templateFiles) {
        if (!file.path) continue;

        try {
          const { data: blob } = await this.octokit!.rest.git.getBlob({
            owner: this.getRepoOwner(),
            repo: this.getRepoName(),
            file_sha: file.sha!,
          });

          const content = Buffer.from(blob.content, 'base64').toString('utf-8');
          templates.push({
            name: file.path.replace('templates/', '').replace('.json', ''),
            path: file.path,
            sha: file.sha!,
            content: JSON.parse(content),
          });
        } catch (error) {
          this.logger.warn(`Failed to fetch template ${file.path}: ${(error as Error).message}`);
        }
      }

      return templates;
    } catch (error) {
      this.logger.error(`Failed to fetch templates from repo: ${(error as Error).message}`, (error as Error).stack);
      return [];
    }
  }

  /**
   * Get a specific template by name
   */
  async getTemplateByName(name: string): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const path = `templates/${sanitizedName}.json`;

      const { data: file } = await this.octokit!.rest.repos.getContent({
        owner: this.getRepoOwner(),
        repo: this.getRepoName(),
        path,
        ref: this.templateBranch,
      });

      if ('content' in file && file.content) {
        const content = Buffer.from(file.content, 'base64').toString('utf-8');
        return JSON.parse(content);
      }

      return null;
    } catch (error) {
      if ((error as any).status === 404) {
        return null;
      }
      this.logger.error(`Failed to fetch template ${name}: ${(error as Error).message}`, (error as Error).stack);
      return null;
    }
  }

  /**
   * Generate PR description
   */
  private generatePRDescription(params: {
    templateName: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
  }): string {
    const { templateName, description, category, tags, author } = params;

    return `## Template Submission: ${templateName}

**Description:** ${description || 'No description provided'}

**Category:** ${category}
**Tags:** ${tags.join(', ') || 'None'}
**Author:** ${author}

---

### Checklist
- [ ] Template follows the naming conventions
- [ ] All secrets have been removed and documented
- [ ] Workflow graph is valid and sanitized
- [ ] Required secrets are documented with placeholders
- [ ] Template has been tested

### Review Notes
<!-- Add any notes for reviewers here -->
`;
  }

  /**
   * Parse repository owner/name from GITHUB_TEMPLATE_REPO env var
   * Format: "owner/repo" or "https://github.com/owner/repo"
   */
  private getRepoOwner(): string {
    const repo = this.templateRepo.replace('https://github.com/', '').replace('.git', '');
    return repo.split('/')[0];
  }

  private getRepoName(): string {
    const repo = this.templateRepo.replace('https://github.com/', '').replace('.git', '');
    return repo.split('/')[1];
  }

  /**
   * Check if a PR exists for a given branch
   */
  async getPRByBranch(branchName: string): Promise<{ number: number; url: string } | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const { data: pulls } = await this.octokit!.rest.pulls.list({
        owner: this.getRepoOwner(),
        repo: this.getRepoName(),
        head: `${this.getRepoOwner()}:${branchName}`,
        state: 'open',
      });

      if (pulls.length > 0) {
        return {
          number: pulls[0].number,
          url: pulls[0].html_url,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to check PR status: ${(error as Error).message}`, (error as Error).stack);
      return null;
    }
  }
}
