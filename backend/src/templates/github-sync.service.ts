import { Injectable, Logger } from '@nestjs/common';
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
  manifest: Record<string, unknown>;
  graph: Record<string, unknown>;
  requiredSecrets: Array<{ name: string; type: string; description?: string }>;
}

/**
 * GitHub Sync Service
 * Fetches templates from a GitHub repository and stores them in the database
 * Uses GitHub's public API (no authentication needed for public repos)
 */
@Injectable()
export class GitHubSyncService {
  private readonly logger = new Logger(GitHubSyncService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly templatesRepository: TemplatesRepository,
  ) {}

  /**
   * Get the GitHub repository configuration from environment variables
   */
  private getRepoConfig(): { owner: string; repo: string; branch: string } {
    const repo = this.configService.get<string>('GITHUB_TEMPLATE_REPO', 'krishna9358/workflow-templates');
    const branch = this.configService.get<string>('GITHUB_TEMPLATE_BRANCH', 'main');
    const [owner, repoName] = repo.split('/');

    if (!owner || !repoName) {
      throw new Error('Invalid GITHUB_TEMPLATE_REPO format. Expected: owner/repo');
    }

    return { owner, repo: repoName, branch };
  }

  /**
   * Fetch directory contents from GitHub
   */
  private async fetchDirectory(path: string): Promise<GitHubFile[]> {
    const { owner, repo, branch } = this.getRepoConfig();
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return []; // Directory doesn't exist
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubFile[];
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch a single file's content from GitHub
   */
  private async fetchFileContent(path: string): Promise<string | null> {
    const { owner, repo, branch } = this.getRepoConfig();
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn(`File not found: ${path}`);
        return null;
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubContentResponse;

    if (data.content && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    return data.download_url ? fetch(data.download_url).then((r) => r.text()) : null;
  }

  /**
   * Parse and validate template JSON
   */
  private parseTemplateJson(content: string, path: string): TemplateJson | null {
    try {
      const template = JSON.parse(content) as TemplateJson;

      // Validate required fields
      if (!template._metadata?.name) {
        this.logger.warn(`Template missing _metadata.name: ${path}`);
        return null;
      }

      if (!template.manifest) {
        this.logger.warn(`Template missing manifest: ${path}`);
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
   * Sync templates from GitHub to the database
   * @returns Summary of sync operation
   */
  async syncTemplates(): Promise<{
    synced: string[];
    failed: Array<{ path: string; error: string }>;
    total: number;
  }> {
    const { owner, repo, branch } = this.getRepoConfig();
    this.logger.log(`Starting template sync from ${owner}/${repo}/${branch}`);

    const synced: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    try {
      // Fetch the templates directory
      const files = await this.fetchDirectory('templates');

      if (files.length === 0) {
        this.logger.warn('No files found in templates/ directory');
        return { synced, failed, total: 0 };
      }

      // Process each template file
      for (const file of files) {
        if (file.type !== 'file') continue;

        // Only process JSON files
        if (!file.name.endsWith('.json')) {
          this.logger.debug(`Skipping non-JSON file: ${file.name}`);
          continue;
        }

        try {
          // Fetch file content
          const content = await this.fetchFileContent(file.path);

          if (!content) {
            failed.push({ path: file.path, error: 'Failed to fetch content' });
            continue;
          }

          // Parse template
          const template = this.parseTemplateJson(content, file.path);

          if (!template) {
            failed.push({ path: file.path, error: 'Invalid template format' });
            continue;
          }

          // Upsert to database
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
            manifest: template.manifest as TemplateManifest,
            graph: template.graph,
            requiredSecrets: template.requiredSecrets,
            isOfficial: false, // TODO: Mark official templates based on author
            isVerified: false, // TODO: Mark verified templates
          });

          synced.push(template._metadata.name);
          this.logger.debug(`Synced template: ${template._metadata.name}`);
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error';
          failed.push({ path: file.path, error });
          this.logger.error(`Failed to sync template: ${file.path}`, err);
        }
      }

      this.logger.log(`Sync complete: ${synced.length} synced, ${failed.length} failed`);
    } catch (err) {
      this.logger.error('Failed to sync templates from GitHub', err);
      throw err;
    }

    return { synced, failed, total: synced.length };
  }

  /**
   * Get repository information
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
