import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TemplatesRepository } from './templates.repository';
import { TemplateManifest } from '../database/schema/templates';

interface GitHubFile {
  name: string;
  path: string;
  type: string;
  url: string;
}

interface GitHubContentResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: string;
  content?: string;
  encoding?: string;
}

interface TemplateJson {
  _metadata: {
    name: string;
    description?: string;
    category: string;
    tags: string[];
    author: string;
    version: string;
  };
  manifest?: Record<string, unknown>;
  graph: Record<string, unknown>;
  requiredSecrets: { name: string; type: string; description?: string }[];
}

/**
 * Cached response with ETag for conditional requests.
 * When GitHub returns 304 Not Modified, we reuse the cached data
 * without consuming a rate limit point.
 */
interface CachedResponse<T> {
  etag: string;
  data: T;
}

/**
 * GitHub Sync Service
 * Fetches templates from a public GitHub repository and stores them in the database.
 * Syncs automatically on startup and on-demand via the admin "Sync from GitHub" button.
 *
 * Uses ETag-based conditional requests to minimize API usage:
 * - First request: GitHub returns data + ETag header
 * - Subsequent requests: We send If-None-Match with the stored ETag
 * - If unchanged: GitHub returns 304 (no body, no rate limit hit)
 * - If changed: GitHub returns 200 with new data + new ETag
 */
@Injectable()
export class GitHubSyncService implements OnModuleInit {
  private readonly logger = new Logger(GitHubSyncService.name);
  private isSyncing = false;

  /** In-memory ETag cache keyed by request URL */
  private readonly etagCache = new Map<string, CachedResponse<unknown>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly templatesRepository: TemplatesRepository,
  ) {}

  /**
   * Sync templates once on startup.
   */
  async onModuleInit(): Promise<void> {
    const { owner, repo, branch } = this.getRepoConfig();
    const hasToken = !!this.getToken();
    this.logger.log(`Template repo: ${owner}/${repo} (branch: ${branch})`);
    this.logger.log(
      `GitHub API auth: ${hasToken ? 'token configured (5000 req/hr)' : 'unauthenticated (60 req/hr)'}`,
    );
    this.logger.log('Starting automatic template sync...');
    try {
      const result = await this.syncTemplates();
      this.logger.log(
        `Startup sync complete: ${result.synced.length} synced, ${result.failed.length} failed`,
      );
    } catch (err) {
      this.logger.error('Startup sync failed', err);
      // Don't throw - allow the application to start even if sync fails
    }
  }

  /**
   * Get the GitHub token for authenticated API requests (optional).
   * With a token: 5,000 requests/hour. Without: 60 requests/hour.
   */
  private getToken(): string | undefined {
    return this.configService.get<string>('GITHUB_TEMPLATE_TOKEN');
  }

  /**
   * Build common headers for GitHub API requests.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Get the GitHub repository configuration from environment variables.
   */
  private getRepoConfig(): { owner: string; repo: string; branch: string } {
    const repo = this.configService.get<string>(
      'GITHUB_TEMPLATE_REPO',
      'krishna9358/workflow-templates',
    );
    const branch = this.configService.get<string>('GITHUB_TEMPLATE_BRANCH', 'main');
    const [owner, repoName] = repo.split('/');

    if (!owner || !repoName) {
      throw new Error('Invalid GITHUB_TEMPLATE_REPO format. Expected: owner/repo');
    }

    return { owner, repo: repoName, branch };
  }

  /**
   * Fetch directory contents from GitHub's public API.
   * Uses ETag conditional requests to avoid redundant data transfer.
   */
  private async fetchDirectory(path: string): Promise<{ files: GitHubFile[]; cached: boolean }> {
    const { owner, repo, branch } = this.getRepoConfig();
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const headers = this.getHeaders();
    const cached = this.etagCache.get(url) as CachedResponse<GitHubFile[]> | undefined;
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    const response = await fetch(url, { headers });

    // 304 Not Modified — use cached data, zero rate limit cost
    if (response.status === 304 && cached) {
      this.logger.debug(`Directory ${path}: not modified (ETag hit)`);
      return { files: cached.data, cached: true };
    }

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn(`Directory not found: ${path}`);
        return { files: [], cached: false };
      }
      if (response.status === 403) {
        const resetHeader = response.headers.get('x-ratelimit-reset');
        const resetIn = resetHeader
          ? Math.ceil((Number(resetHeader) * 1000 - Date.now()) / 60000)
          : '?';
        this.logger.warn(
          `GitHub API rate limit exceeded. Resets in ~${resetIn} min. Skipping sync.`,
        );
        return { files: [], cached: false };
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubFile[];
    const files = Array.isArray(data) ? data : [];

    // Cache the response with its ETag for future conditional requests
    const etag = response.headers.get('etag');
    if (etag) {
      this.etagCache.set(url, { etag, data: files });
    }

    return { files, cached: false };
  }

  /**
   * Fetch a single file's content from GitHub.
   * Uses ETag conditional requests to skip re-downloading unchanged files.
   */
  private async fetchFileContent(
    path: string,
  ): Promise<{ content: string | null; cached: boolean }> {
    const { owner, repo, branch } = this.getRepoConfig();
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const headers = this.getHeaders();
    const cached = this.etagCache.get(url) as CachedResponse<string> | undefined;
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    const response = await fetch(url, { headers });

    // 304 Not Modified — use cached content, zero rate limit cost
    if (response.status === 304 && cached) {
      this.logger.debug(`File ${path}: not modified (ETag hit)`);
      return { content: cached.data, cached: true };
    }

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn(`File not found: ${path}`);
        return { content: null, cached: false };
      }
      if (response.status === 403) {
        this.logger.warn('GitHub API rate limit exceeded, skipping file fetch');
        return { content: null, cached: false };
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubContentResponse;
    let content: string | null = null;

    if (data.content && data.encoding === 'base64') {
      content = Buffer.from(data.content, 'base64').toString('utf-8');
    } else if (data.download_url) {
      const dlResponse = await fetch(data.download_url);
      content = await dlResponse.text();
    }

    // Cache the response with its ETag
    const etag = response.headers.get('etag');
    if (etag && content) {
      this.etagCache.set(url, { etag, data: content });
    }

    return { content, cached: false };
  }

  /**
   * Strip JSONC comments (single-line and multi-line) from a string.
   * Preserves comment-like sequences inside JSON strings.
   */
  private stripJsonComments(text: string): string {
    let result = '';
    let i = 0;
    let inString = false;

    while (i < text.length) {
      if (!inString && text[i] === '"') {
        inString = true;
        result += text[i];
        i++;
        continue;
      }

      if (inString) {
        if (text[i] === '\\') {
          result += text[i] + (text[i + 1] || '');
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          inString = false;
        }
        result += text[i];
        i++;
        continue;
      }

      // Single-line comment
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }

      // Multi-line comment
      if (text[i] === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2;
        continue;
      }

      result += text[i];
      i++;
    }

    return result;
  }

  /**
   * Parse and validate template JSON/JSONC.
   * Strips comments before parsing to support JSONC format.
   */
  private parseTemplateJson(content: string, path: string): TemplateJson | null {
    try {
      const stripped = this.stripJsonComments(content);
      const template = JSON.parse(stripped) as TemplateJson;

      if (!template._metadata?.name) {
        this.logger.warn(`Template missing _metadata.name: ${path}`);
        return null;
      }

      if (!template.graph) {
        this.logger.warn(`Template missing graph: ${path}`);
        return null;
      }

      return template;
    } catch (err) {
      this.logger.error(`Failed to parse template JSON: ${path}`, err);
      return null;
    }
  }

  /**
   * Sync templates from GitHub to the database.
   * Called on startup and when admin clicks "Sync from GitHub".
   *
   * Uses ETag conditional requests: if the directory listing hasn't changed,
   * the entire sync is skipped with zero API cost. Individual file fetches
   * also use ETags so unchanged files are not re-downloaded.
   */
  async syncTemplates(): Promise<{
    synced: string[];
    failed: { path: string; error: string }[];
    unchanged: string[];
    total: number;
    directoryCacheHit: boolean;
  }> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping');
      return { synced: [], failed: [], unchanged: [], total: 0, directoryCacheHit: false };
    }
    this.isSyncing = true;

    const { owner, repo, branch } = this.getRepoConfig();
    this.logger.log(`Starting template sync from ${owner}/${repo}/${branch}`);

    const synced: string[] = [];
    const failed: { path: string; error: string }[] = [];
    const unchanged: string[] = [];
    let dirCacheHit = false;

    try {
      const { files, cached } = await this.fetchDirectory('templates');
      dirCacheHit = cached;

      if (files.length === 0) {
        this.logger.warn('No files found in templates/ directory');
        return { synced, failed, unchanged, total: 0, directoryCacheHit: dirCacheHit };
      }

      if (dirCacheHit) {
        this.logger.log(
          `Directory listing unchanged (ETag cache hit). Checking ${files.length} files...`,
        );
      }

      for (const file of files) {
        if (file.type !== 'file') continue;
        if (!file.name.endsWith('.json') && !file.name.endsWith('.jsonc')) continue;

        try {
          const { content, cached: fileCacheHit } = await this.fetchFileContent(file.path);

          if (!content) {
            failed.push({ path: file.path, error: 'Failed to fetch content' });
            continue;
          }

          // If the file content is unchanged (ETag hit), still upsert to keep
          // the DB in sync but track it as unchanged for reporting
          if (fileCacheHit) {
            unchanged.push(file.path);
          }

          const template = this.parseTemplateJson(content, file.path);

          if (!template) {
            failed.push({
              path: file.path,
              error: 'Invalid template format',
            });
            continue;
          }

          // Build manifest from _metadata if not provided separately
          const manifest: TemplateManifest = (template.manifest as TemplateManifest) || {
            name: template._metadata.name,
            description: template._metadata.description,
            version: template._metadata.version,
            author: template._metadata.author,
            category: template._metadata.category,
            tags: template._metadata.tags,
          };

          await this.templatesRepository.upsert({
            name: template._metadata.name,
            description: template._metadata.description,
            category: template._metadata.category || 'other',
            tags: template._metadata.tags || [],
            author: template._metadata.author,
            repository: `${owner}/${repo}`,
            path: file.path,
            branch,
            version: template._metadata.version,
            manifest,
            graph: template.graph,
            requiredSecrets: template.requiredSecrets,
          });

          synced.push(template._metadata.name);
          this.logger.debug(`Synced template: ${template._metadata.name}`);
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error';
          failed.push({ path: file.path, error });
          this.logger.error(`Failed to sync template: ${file.path}`, err);
        }
      }

      const cacheStats = unchanged.length > 0 ? `, ${unchanged.length} unchanged (ETag)` : '';
      this.logger.log(
        `Sync complete: ${synced.length} synced, ${failed.length} failed${cacheStats}`,
      );
    } catch (err) {
      this.logger.error('Failed to sync templates from GitHub', err);
      throw err;
    } finally {
      this.isSyncing = false;
    }

    return {
      synced,
      failed,
      unchanged,
      total: synced.length,
      directoryCacheHit: dirCacheHit,
    };
  }

  /**
   * Get repository information.
   */
  async getRepositoryInfo(): Promise<{
    owner: string;
    repo: string;
    branch: string;
    url: string;
  }> {
    const { owner, repo, branch } = this.getRepoConfig();
    return {
      owner,
      repo,
      branch,
      url: `https://github.com/${owner}/${repo}`,
    };
  }
}
