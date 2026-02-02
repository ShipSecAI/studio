import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  type ExecutionContext,
  ConfigurationError,
  NetworkError,
  NotFoundError,
  fromHttpResponse,
  defineComponent,
  inputs,
  outputs,
  port,
  DEFAULT_SENSITIVE_HEADERS,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  organization: port(z.string().trim().min(1, 'Organization is required.'), {
    label: 'Organization',
    description: 'GitHub organization login (e.g. shipsecai).',
  }),
  teamSlug: port(z.string().trim().min(1, 'Team slug cannot be empty.').optional(), {
    label: 'Team Slug',
    description: 'Optional GitHub team slug to remove the user before organization removal.',
  }),
  userIdentifier: port(z.string().trim().min(1, 'Provide a GitHub username or email address.'), {
    label: 'Username or Email',
    description: 'GitHub username or email of the member to remove.',
  }),
  connectionId: port(
    z
      .string()
      .trim()
      .min(1, 'Select a GitHub connection to reuse.')
      .describe('GitHub integration connection ID'),
    {
      label: 'GitHub Connection',
      description:
        'GitHub integration connection ID supplied from the GitHub Connection Provider component.',
      valuePriority: 'connection-first',
    },
  ),
});

export type GitHubRemoveOrgMembershipInput = typeof inputSchema;

const outputSchema = outputs({
  result: port(z.record(z.string(), z.unknown()), {
    label: 'Removal Result',
    description: 'Outcome of team and organization removal attempts.',
    allowAny: true,
    reason: 'GitHub removal responses include variable metadata.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  organization: port(z.string(), {
    label: 'Organization',
    description: 'GitHub organization name.',
  }),
  teamSlug: port(z.string().optional(), {
    label: 'Team Slug',
    description: 'Team slug targeted for removal, if provided.',
  }),
  userIdentifier: port(z.string(), {
    label: 'User Identifier',
    description: 'Original user identifier supplied to the component.',
  }),
  resolvedLogin: port(z.string(), {
    label: 'Resolved Login',
    description: 'Resolved GitHub username used for removal.',
  }),
  teamRemovalStatus: port(z.enum(['removed', 'not_found', 'skipped']).optional(), {
    label: 'Team Removal Status',
    description: 'Outcome of team removal attempt.',
  }),
  organizationRemovalStatus: port(z.enum(['removed', 'not_found']), {
    label: 'Organization Removal Status',
    description: 'Outcome of organization removal attempt.',
  }),
  removedFromTeam: port(z.boolean(), {
    label: 'Removed From Team',
    description: 'Whether the user was removed from the team.',
  }),
  removedFromOrganization: port(z.boolean(), {
    label: 'Removed From Organization',
    description: 'Whether the user was removed from the organization.',
  }),
  message: port(z.string(), {
    label: 'Message',
    description: 'Summary message for the removal attempt.',
  }),
  tokenScope: port(z.string().optional(), {
    label: 'Token Scope',
    description: 'GitHub token scope detected during the operation.',
  }),
});

export type GitHubRemoveOrgMembershipOutput = typeof outputSchema;

const definition = defineComponent({
  id: 'github.org.membership.remove',
  label: 'GitHub Remove Org Membership',
  category: 'output',
  runner: { kind: 'inline' },
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: [
      'ConfigurationError',
      'AuthenticationError',
      'PermissionError',
      'ValidationError',
    ],
  } satisfies ComponentRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Launches a GitHub device authorization flow (using provided client credentials) and removes a user from a GitHub team (optional) and organization to free up a seat.',
  ui: {
    slug: 'github-remove-org-membership',
    version: '1.0.0',
    type: 'output',
    category: 'it_ops',
    description:
      'Automates GitHub organization seat recovery by running a device OAuth flow (client ID + secret) and removing the user from the organization and optionally a team.',
    icon: 'UserMinus',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Offboarding an employee by removing their GitHub organization access automatically.',
      'Cleaning up inactive contractors from a specific team and the organization.',
    ],
  },
  async execute({ inputs }, context) {
    const { organization, teamSlug, userIdentifier, connectionId } = inputSchema.parse(inputs);

    const trimmedConnectionId = connectionId.trim();

    if (trimmedConnectionId.length === 0) {
      throw new ConfigurationError(
        'GitHub connection ID is required when using an existing connection.',
        {
          configKey: 'connectionId',
        },
      );
    }

    context.emitProgress(
      `Retrieving GitHub access token from connection ${trimmedConnectionId}...`,
    );
    const connectionToken = await fetchConnectionAccessToken(trimmedConnectionId, context);
    const accessToken = connectionToken.accessToken;
    const tokenType = connectionToken.tokenType ?? 'Bearer';
    const tokenScope =
      Array.isArray(connectionToken.scopes) && connectionToken.scopes.length > 0
        ? connectionToken.scopes.join(' ')
        : undefined;

    const authorizationScheme =
      tokenType && tokenType.trim().length > 0 ? tokenType.trim() : 'Bearer';

    const headers = {
      // Use token obtained via selected authentication mode
      Authorization: `${authorizationScheme} ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shipsecai-worker/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const login = await resolveLogin(userIdentifier, headers, context);

    let teamRemovalStatus: 'removed' | 'not_found' | 'skipped' = 'skipped';
    let removedFromTeam = false;

    if (teamSlug) {
      context.emitProgress(`Removing ${login} from team ${teamSlug}...`);
      let teamResponse: Response;
      try {
        teamResponse = await context.http.fetch(
          `https://api.github.com/orgs/${encodeURIComponent(organization)}/teams/${encodeURIComponent(teamSlug)}/memberships/${encodeURIComponent(login)}`,
          {
            method: 'DELETE',
            headers,
          },
        );
      } catch (error) {
        throw new NetworkError(
          `GitHub API request failed while removing ${login} from team ${teamSlug}: ${(error as Error).message}`,
          { cause: error as Error },
        );
      }

      if (teamResponse.status === 204) {
        teamRemovalStatus = 'removed';
        removedFromTeam = true;
        context.logger.info(`[GitHub] Removed ${login} from team ${teamSlug}.`);
      } else if (teamResponse.status === 404) {
        teamRemovalStatus = 'not_found';
        context.logger.info(
          `[GitHub] ${login} not found in team ${teamSlug}. Continuing with organization removal.`,
        );
      } else {
        const errorBody = await safeReadText(teamResponse);
        throw fromHttpResponse(
          teamResponse,
          `Failed to remove ${login} from team ${teamSlug}: ${errorBody}`,
        );
      }
    }

    context.emitProgress(`Removing ${login} from organization ${organization}...`);
    let orgResponse: Response;
    try {
      orgResponse = await context.http.fetch(
        `https://api.github.com/orgs/${encodeURIComponent(organization)}/members/${encodeURIComponent(login)}`,
        {
          method: 'DELETE',
          headers,
        },
      );
    } catch (error) {
      throw new NetworkError(
        `GitHub API request failed while removing ${login} from organization ${organization}: ${(error as Error).message}`,
        { cause: error as Error },
      );
    }

    if (orgResponse.status === 204) {
      context.logger.info(`[GitHub] Removed ${login} from organization ${organization}.`);
      context.emitProgress(`Removed ${login} from organization ${organization}.`);
      const teamStatus = teamRemovalStatus ?? 'skipped';
      const organizationStatus = 'removed';
      const result = {
        organization,
        teamSlug,
        userIdentifier,
        resolvedLogin: login,
        teamRemovalStatus: teamStatus,
        organizationRemovalStatus: organizationStatus,
        removedFromTeam,
        removedFromOrganization: true,
        message: `Removed ${login} from ${organization}.`,
        tokenScope,
      };

      return outputSchema.parse({
        ...result,
        result,
      });
    }

    if (orgResponse.status === 404) {
      context.logger.info(`[GitHub] ${login} is not a member of organization ${organization}.`);
      context.emitProgress(`${login} is already absent from organization ${organization}.`);
      const teamStatus = teamRemovalStatus ?? 'skipped';
      const organizationStatus = 'not_found';
      const result = {
        organization,
        teamSlug,
        userIdentifier,
        resolvedLogin: login,
        teamRemovalStatus: teamStatus,
        organizationRemovalStatus: organizationStatus,
        removedFromTeam,
        removedFromOrganization: false,
        message: `${login} is not an active member of ${organization}.`,
        tokenScope,
      };

      return outputSchema.parse({
        ...result,
        result,
      });
    }

    const errorBody = await safeReadText(orgResponse);
    throw fromHttpResponse(
      orgResponse,
      `Failed to remove ${login} from organization ${organization}: ${errorBody}`,
    );
  },
});

async function fetchConnectionAccessToken(
  connectionId: string,
  context: ExecutionContext,
): Promise<{
  accessToken: string;
  tokenType?: string;
  scopes?: string[];
  expiresAt?: string | null;
}> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;

  const baseUrl =
    process.env.STUDIO_API_BASE_URL ??
    process.env.SHIPSEC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    'http://localhost:3211';

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  if (!internalToken) {
    context.emitProgress({
      level: 'warn',
      message:
        'INTERNAL_SERVICE_TOKEN env var not set; requesting GitHub connection token without internal auth header.',
    });
  }

  const sensitiveHeaders = internalToken
    ? Array.from(new Set([...DEFAULT_SENSITIVE_HEADERS, 'x-internal-token']))
    : DEFAULT_SENSITIVE_HEADERS;

  const response = await context.http.fetch(
    `${normalizedBase}/integrations/connections/${encodeURIComponent(connectionId)}/token`,
    {
      method: 'POST',
      headers: internalToken
        ? {
            'Content-Type': 'application/json',
            'X-Internal-Token': internalToken,
          }
        : {
            'Content-Type': 'application/json',
          },
    },
    { sensitiveHeaders },
  );

  if (!response.ok) {
    const raw = await safeReadText(response);
    throw fromHttpResponse(
      response,
      `Failed to fetch GitHub token from connection ${connectionId}: ${raw}`,
    );
  }

  const payload = (await response.json()) as {
    accessToken?: string;
    tokenType?: string;
    scopes?: string[];
    expiresAt?: string | null;
  };

  if (!payload.accessToken || payload.accessToken.trim().length === 0) {
    throw new ConfigurationError(
      `GitHub connection ${connectionId} did not provide an access token.`,
      {
        configKey: 'connectionId',
        details: { connectionId },
      },
    );
  }

  context.logger.info(`[GitHub] Using stored OAuth token from connection ${connectionId}.`);

  return {
    accessToken: payload.accessToken,
    tokenType: payload.tokenType,
    scopes: payload.scopes,
    expiresAt: payload.expiresAt,
  };
}

async function resolveLogin(
  identifier: string,
  headers: Record<string, string>,
  context: ExecutionContext,
): Promise<string> {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) {
    context.emitProgress('Resolving GitHub username from email...');
    const query = encodeURIComponent(`${trimmed} in:email`);
    const searchResponse = await context.http.fetch(
      `https://api.github.com/search/users?q=${query}&per_page=1`,
      {
        headers,
      },
    );

    if (!searchResponse.ok) {
      const body = await safeReadText(searchResponse);
      throw fromHttpResponse(
        searchResponse,
        `Failed to resolve GitHub username for ${trimmed}: ${body}`,
      );
    }

    const payload = (await searchResponse.json()) as {
      total_count: number;
      items: { login: string }[];
    };

    if (!payload.total_count || payload.items.length === 0) {
      throw new NotFoundError(
        `No public GitHub user found for email ${trimmed}. Provide a username instead.`,
        {
          resourceType: 'user',
          resourceId: trimmed,
        },
      );
    }

    const { login } = payload.items[0];
    context.logger.info(`[GitHub] Resolved email ${trimmed} to username ${login}.`);
    return login;
  }

  context.logger.info(`[GitHub] Using provided username ${trimmed}.`);
  return trimmed;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `<<unable to read body: ${(error as Error).message}>>`;
  }
}

componentRegistry.register(definition);
