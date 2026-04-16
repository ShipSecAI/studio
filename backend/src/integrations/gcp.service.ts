import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';

interface AccessTokenClient {
  getAccessToken(): Promise<string | { token?: string | null } | null | undefined>;
}

interface GoogleAuthLike {
  getClient(): Promise<AccessTokenClient>;
}

interface ServiceAccountSourceCredential {
  type: 'service_account';
  project_id: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  client_id?: string;
  token_uri?: string;
}

type GoogleAuthConstructor = new (options: {
  credentials?: ServiceAccountSourceCredential;
  scopes?: string[];
}) => GoogleAuthLike;

let GoogleAuthImplPromise: Promise<GoogleAuthConstructor> | null = null;

export interface GcpValidationResult {
  serviceAccountEmail: string;
  serviceAccountUniqueId?: string;
  defaultProjectId?: string;
  organizationId?: string;
  projects: GcpDiscoveredResource[];
}

export interface GcpDiscoveredResource {
  id: string;
  displayName: string;
  type: 'project' | 'folder' | 'organization';
  parent?: string;
  state?: string;
}

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform.read-only';
const CLOUD_RESOURCE_MANAGER_V3 = 'https://cloudresourcemanager.googleapis.com/v3';
const CLOUD_RESOURCE_MANAGER_V1 = 'https://cloudresourcemanager.googleapis.com/v1';
const IAM_CREDENTIALS_SCOPE = 'https://www.googleapis.com/auth/iam';
const IAM_CREDENTIALS_BASE = 'https://iamcredentials.googleapis.com/v1';
const IAM_BASE = 'https://iam.googleapis.com/v1';
const IMPERSONATION_SOURCE_CREDENTIALS_ENV = 'SHIPSEC_GCP_IMPERSONATION_SOURCE_CREDENTIALS_JSON';

export type GcpValidationMetadata = Record<string, unknown> & {
  defaultProjectId?: string | null;
  organizationId?: string | null;
  clientEmail?: string | null;
  serviceAccountUniqueId?: string | null;
  discoveredResources?: GcpDiscoveredResource[];
};

@Injectable()
export class GcpService {
  getImpersonationSourcePrincipal(): {
    serviceAccountEmail: string;
    serviceAccountMember: string;
    sourceProjectId?: string;
  } {
    const source =
      this.loadImpersonationSourceCredentials() ??
      this.loadGoogleApplicationCredentialsFromFilePath();

    if (!source) {
      throw new Error(
        'GCP impersonation source principal is not configured. Set SHIPSEC_GCP_IMPERSONATION_SOURCE_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON).',
      );
    }

    return {
      serviceAccountEmail: source.client_email,
      serviceAccountMember: `serviceAccount:${source.client_email}`,
      sourceProjectId: source.project_id || undefined,
    };
  }

  async validateServiceAccount(input: {
    targetServiceAccountEmail: string;
    defaultProjectId?: string;
    organizationId?: string;
  }): Promise<GcpValidationResult> {
    const targetServiceAccountEmail = this.normalizeServiceAccountEmail(
      input.targetServiceAccountEmail,
    );
    const accessToken = await this.generateImpersonatedAccessToken(targetServiceAccountEmail, [
      CLOUD_PLATFORM_SCOPE,
    ]);
    const identity = await this.getServiceAccountIdentity(targetServiceAccountEmail);
    const discovery = await this.discoverResources(accessToken);

    return {
      serviceAccountEmail: targetServiceAccountEmail,
      serviceAccountUniqueId: identity?.uniqueId,
      defaultProjectId:
        input.defaultProjectId?.trim() || discovery.find((r) => r.type === 'project')?.id,
      organizationId: input.organizationId?.trim() || undefined,
      projects: discovery,
    };
  }

  async discoverProjects(input: {
    targetServiceAccountEmail: string;
  }): Promise<GcpDiscoveredResource[]> {
    const targetServiceAccountEmail = this.normalizeServiceAccountEmail(
      input.targetServiceAccountEmail,
    );
    const accessToken = await this.generateImpersonatedAccessToken(targetServiceAccountEmail, [
      CLOUD_PLATFORM_SCOPE,
    ]);
    return this.discoverResources(accessToken);
  }

  async generateImpersonatedAccessToken(
    targetServiceAccountEmail: string,
    scopes: string[],
  ): Promise<string> {
    const sourceToken = await this.getSourceAccessToken([IAM_CREDENTIALS_SCOPE]);
    const response = await fetch(
      `${IAM_CREDENTIALS_BASE}/projects/-/serviceAccounts/${encodeURIComponent(
        targetServiceAccountEmail,
      )}:generateAccessToken`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sourceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: scopes,
          lifetime: '3600s',
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Failed to impersonate ${targetServiceAccountEmail} (${response.status}): ${text}`,
      );
    }

    const payload = (await response.json()) as { accessToken?: string };
    if (!payload.accessToken) {
      throw new Error(
        `Failed to impersonate ${targetServiceAccountEmail}: no access token returned`,
      );
    }

    return payload.accessToken;
  }

  private normalizeServiceAccountEmail(rawEmail: string): string {
    const email = rawEmail.trim();
    if (!email.includes('@') || !email.endsWith('.gserviceaccount.com')) {
      throw new Error('Target service account email must be a valid *.gserviceaccount.com address');
    }
    return email;
  }

  private async createSourceAuth(scopes: string[]): Promise<GoogleAuthLike> {
    if (!GoogleAuthImplPromise) {
      GoogleAuthImplPromise = import('google-auth-library').then(
        (mod) => mod.GoogleAuth as GoogleAuthConstructor,
      );
    }

    const GoogleAuth = await GoogleAuthImplPromise;
    const sourceCredentials = this.loadImpersonationSourceCredentials();

    return new GoogleAuth({
      ...(sourceCredentials ? { credentials: sourceCredentials } : {}),
      scopes,
    });
  }

  private loadImpersonationSourceCredentials(): ServiceAccountSourceCredential | null {
    const raw = process.env[IMPERSONATION_SOURCE_CREDENTIALS_ENV]?.trim();
    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${IMPERSONATION_SOURCE_CREDENTIALS_ENV} is not valid JSON`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${IMPERSONATION_SOURCE_CREDENTIALS_ENV} must be a JSON object`);
    }

    const value = parsed as Record<string, unknown>;
    if (
      value.type !== 'service_account' ||
      typeof value.project_id !== 'string' ||
      typeof value.private_key !== 'string' ||
      typeof value.client_email !== 'string'
    ) {
      throw new Error(
        `${IMPERSONATION_SOURCE_CREDENTIALS_ENV} must contain a service account JSON payload`,
      );
    }

    return value as unknown as ServiceAccountSourceCredential;
  }

  private loadGoogleApplicationCredentialsFromFilePath(): ServiceAccountSourceCredential | null {
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (!path) {
      return null;
    }
    if (!existsSync(path)) {
      return null;
    }

    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed.type === 'service_account' &&
        typeof parsed.project_id === 'string' &&
        typeof parsed.private_key === 'string' &&
        typeof parsed.client_email === 'string'
      ) {
        return parsed as unknown as ServiceAccountSourceCredential;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async getSourceAccessToken(scopes: string[]): Promise<string> {
    const auth = await this.createSourceAuth(scopes);
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
    if (!token) {
      throw new Error('Unable to obtain source GCP access token for impersonation');
    }
    return token;
  }

  private async getServiceAccountIdentity(
    serviceAccountEmail: string,
  ): Promise<{ uniqueId?: string } | null> {
    try {
      const sourceToken = await this.getSourceAccessToken([IAM_CREDENTIALS_SCOPE]);
      const response = await fetch(
        `${IAM_BASE}/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}`,
        {
          headers: { Authorization: `Bearer ${sourceToken}` },
        },
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { uniqueId?: string };
      return { uniqueId: payload.uniqueId };
    } catch {
      return null;
    }
  }

  private async discoverResources(accessToken: string): Promise<GcpDiscoveredResource[]> {
    const projects = await this.listProjects(accessToken);
    const folders = await this.listFolders(accessToken, projects);
    const organizations = await this.listOrganizations(accessToken, [...projects, ...folders]);

    const byKey = new Map<string, GcpDiscoveredResource>();
    for (const resource of [...organizations, ...folders, ...projects]) {
      byKey.set(`${resource.type}:${resource.id}`, resource);
    }

    return Array.from(byKey.values()).sort((a, b) => {
      const typeCompare = a.type.localeCompare(b.type);
      if (typeCompare !== 0) return typeCompare;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  private async listProjects(accessToken: string): Promise<GcpDiscoveredResource[]> {
    const items = await this.fetchPaginated<{
      projectId?: string;
      name?: string;
      lifecycleState?: string;
      parent?: {
        id?: string;
        type?: string;
      };
    }>(`${CLOUD_RESOURCE_MANAGER_V1}/projects`, 'projects', accessToken);

    return items
      .filter((item) => item.projectId)
      .map((item) => {
        const parentType = item.parent?.type?.toLowerCase();
        const parentId = item.parent?.id;
        const parent =
          parentType && parentId && (parentType === 'folder' || parentType === 'organization')
            ? `${parentType}s/${parentId}`
            : undefined;

        return {
          id: item.projectId!,
          displayName: item.name?.trim() || item.projectId!,
          type: 'project' as const,
          parent,
          state: item.lifecycleState,
        };
      });
  }

  private async listFolders(
    accessToken: string,
    projects: GcpDiscoveredResource[],
  ): Promise<GcpDiscoveredResource[]> {
    const folderNames = new Set(
      projects
        .map((project) => project.parent)
        .filter((parent): parent is string => !!parent && parent.startsWith('folders/')),
    );

    const folders: GcpDiscoveredResource[] = [];
    for (const folderName of folderNames) {
      const response = await fetch(`${CLOUD_RESOURCE_MANAGER_V3}/${folderName}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        name?: string;
        displayName?: string;
        state?: string;
        parent?: string;
      };
      const id = payload.name?.split('/')[1];
      if (!id) continue;
      folders.push({
        id,
        displayName: payload.displayName?.trim() || id,
        type: 'folder',
        parent: payload.parent,
        state: payload.state,
      });
    }

    return folders;
  }

  private async listOrganizations(
    accessToken: string,
    resources: GcpDiscoveredResource[],
  ): Promise<GcpDiscoveredResource[]> {
    const orgNames = new Set(
      resources
        .map((resource) => resource.parent)
        .filter((parent): parent is string => !!parent && parent.startsWith('organizations/')),
    );

    const organizations: GcpDiscoveredResource[] = [];
    for (const orgName of orgNames) {
      const response = await fetch(`${CLOUD_RESOURCE_MANAGER_V1}/${orgName}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        name?: string;
        displayName?: string;
        owner?: { directoryCustomerId?: string };
      };
      const id = payload.name?.split('/')[1];
      if (!id) continue;
      organizations.push({
        id,
        displayName: payload.displayName?.trim() || id,
        type: 'organization',
        parent: payload.owner?.directoryCustomerId,
      });
    }

    return organizations;
  }

  private async fetchPaginated<T extends Record<string, unknown>>(
    baseUrl: string,
    listKey: string,
    accessToken: string,
  ): Promise<T[]> {
    const items: T[] = [];
    let nextPageToken: string | undefined;

    do {
      const url = new URL(baseUrl);
      if (nextPageToken) {
        url.searchParams.set('pageToken', nextPageToken);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`GCP discovery failed (${response.status}): ${text}`);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const pageItems = Array.isArray(payload[listKey]) ? (payload[listKey] as T[]) : [];
      items.push(...pageItems);
      nextPageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : undefined;
    } while (nextPageToken);

    return items;
  }
}
