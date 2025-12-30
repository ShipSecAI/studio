import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  port,
  type ComponentDefinition,
  type ExecutionContext,
  ConfigurationError,
  AuthenticationError,
  PermissionError,
  NetworkError,
  TimeoutError,
  NotFoundError,
  fromHttpResponse,
} from '@shipsec/component-sdk';

const inputSchema = z
  .object({
    organization: z.string().trim().min(1, 'Organization is required.'),
    teamSlug: z
      .string()
      .trim()
      .min(1, 'Team slug cannot be empty.')
      .optional(),
    userIdentifier: z
      .string()
      .trim()
      .min(1, 'Provide a GitHub username or email address.'),
    connectionId: z
      .string()
      .trim()
      .min(1, 'Select a GitHub connection to reuse.')
      .describe('GitHub integration connection ID'),
  })
  .transform((value) => ({
    ...value,
    connectionId: value.connectionId.trim(),
  }));

export type GitHubRemoveOrgMembershipInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  organization: z.string(),
  teamSlug: z.string().optional(),
  userIdentifier: z.string(),
  resolvedLogin: z.string(),
  teamRemovalStatus: z.enum(['removed', 'not_found', 'skipped']).optional(),
  organizationRemovalStatus: z.enum(['removed', 'not_found']),
  removedFromTeam: z.boolean(),
  removedFromOrganization: z.boolean(),
  message: z.string(),
  tokenScope: z.string().optional(),
});

export type GitHubRemoveOrgMembershipOutput = z.infer<typeof outputSchema>;

const definition: ComponentDefinition<
  GitHubRemoveOrgMembershipInput,
  GitHubRemoveOrgMembershipOutput
> = {
  id: 'github.org.membership.remove',
  label: 'GitHub Remove Org Membership',
  category: 'output',
  runner: { kind: 'inline' },
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ConfigurationError', 'AuthenticationError', 'PermissionError', 'ValidationError'],
  } satisfies ComponentRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Launches a GitHub device authorization flow (using provided client credentials) and removes a user from a GitHub team (optional) and organization to free up a seat.',
  metadata: {
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
    inputs: [
      {
        id: 'organization',
        label: 'Organization',
        dataType: port.text({ coerceFrom: [] }),
        required: true,
        description: 'GitHub organization login (e.g. shipsecai).',
      },
      {
        id: 'teamSlug',
        label: 'Team Slug',
        dataType: port.text({ coerceFrom: [] }),
        required: false,
        description: 'Optional GitHub team slug to remove the user before organization removal.',
      },
      {
        id: 'userIdentifier',
        label: 'Username or Email',
        dataType: port.text({ coerceFrom: [] }),
        required: true,
        description: 'GitHub username or email of the member to remove.',
      },
      {
        id: 'connectionId',
        label: 'GitHub Connection',
        dataType: port.text({ coerceFrom: [] }),
        required: true,
        description:
          'GitHub integration connection ID supplied from the GitHub Connection Provider component.',
        valuePriority: 'connection-first',
      },
    ],
    outputs: [
      {
        id: 'result',
        label: 'Removal Result',
        dataType: port.json(),
        description: 'Outcome of team and organization removal attempts.',
      },
    ],
    examples: [
      'Offboarding an employee by removing their GitHub organization access automatically.',
      'Cleaning up inactive contractors from a specific team and the organization.',
    ],
    parameters: [
      {
        id: 'organization',
        label: 'Organization',
        type: 'text',
        required: true,
        description: 'Default organization login. Can be overridden via connected inputs.',
      },
      {
        id: 'teamSlug',
        label: 'Team Slug',
        type: 'text',
        required: false,
        description: 'Optional team slug to target before removing the organization membership.',
      },
    ],
  },
  async execute(params, context) {
    const {
      organization,
      teamSlug,
      userIdentifier,
      connectionId,
    } = params;

    let accessToken: string;
    let tokenType = 'Bearer';
    let tokenScope: string | undefined;

    const trimmedConnectionId = connectionId.trim();

    if (trimmedConnectionId.length === 0) {
      throw new ConfigurationError('GitHub connection ID is required when using an existing connection.', {
        configKey: 'connectionId',
      });
    }

    context.emitProgress(
      `Retrieving GitHub access token from connection ${trimmedConnectionId}...`,
    );
    const connectionToken = await fetchConnectionAccessToken(trimmedConnectionId, context);
    accessToken = connectionToken.accessToken;
    tokenType = connectionToken.tokenType ?? 'Bearer';
    tokenScope =
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
        teamResponse = await fetch(
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
        context.logger.info(`[GitHub] ${login} not found in team ${teamSlug}. Continuing with organization removal.`);
      } else {
        const errorBody = await safeReadText(teamResponse);
        throw fromHttpResponse(teamResponse, `Failed to remove ${login} from team ${teamSlug}: ${errorBody}`);
      }
    }

    context.emitProgress(`Removing ${login} from organization ${organization}...`);
    let orgResponse: Response;
    try {
      orgResponse = await fetch(
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
      return {
        organization,
        teamSlug,
        userIdentifier,
        resolvedLogin: login,
        teamRemovalStatus: teamRemovalStatus ?? 'skipped',
        organizationRemovalStatus: 'removed',
        removedFromTeam,
        removedFromOrganization: true,
        message: `Removed ${login} from ${organization}.`,
        tokenScope,
      };
    }

    if (orgResponse.status === 404) {
      context.logger.info(`[GitHub] ${login} is not a member of organization ${organization}.`);
      context.emitProgress(`${login} is already absent from organization ${organization}.`);
      return {
        organization,
        teamSlug,
        userIdentifier,
        resolvedLogin: login,
        teamRemovalStatus: teamRemovalStatus ?? 'skipped',
        organizationRemovalStatus: 'not_found',
        removedFromTeam,
        removedFromOrganization: false,
        message: `${login} is not an active member of ${organization}.`,
        tokenScope,
      };
    }

    const errorBody = await safeReadText(orgResponse);
    throw fromHttpResponse(orgResponse, `Failed to remove ${login} from organization ${organization}: ${errorBody}`);
  },
};

async function fetchConnectionAccessToken(
  connectionId: string,
  context: ExecutionContext,
): Promise<{ accessToken: string; tokenType?: string; scopes?: string[]; expiresAt?: string | null }> {
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

  const response = await fetch(
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
  );

  if (!response.ok) {
    const raw = await safeReadText(response);
    throw fromHttpResponse(response, `Failed to fetch GitHub token from connection ${connectionId}: ${raw}`);
  }

  const payload = (await response.json()) as {
    accessToken?: string;
    tokenType?: string;
    scopes?: string[];
    expiresAt?: string | null;
  };

  if (!payload.accessToken || payload.accessToken.trim().length === 0) {
    throw new ConfigurationError(`GitHub connection ${connectionId} did not provide an access token.`, {
      configKey: 'connectionId',
      details: { connectionId },
    });
  }

  context.logger.info(`[GitHub] Using stored OAuth token from connection ${connectionId}.`);

  return {
    accessToken: payload.accessToken,
    tokenType: payload.tokenType,
    scopes: payload.scopes,
    expiresAt: payload.expiresAt,
  };
}

async function completeDeviceAuthorization(
  clientId: string,
  clientSecret: string,
  context: ExecutionContext,
): Promise<{ accessToken: string; scope?: string }> {
  context.emitProgress('Starting GitHub device authorization...');
  const device = await requestDeviceCode(clientId, context);

  const instructionUrl = device.verificationUriComplete ?? device.verificationUri;
  context.logger.info(
    `[GitHub] Prompting for device authorization at ${instructionUrl}. Code ${device.userCode}`,
  );
  context.emitProgress(
    `Authorize GitHub access at ${instructionUrl} using code ${device.userCode}. Waiting for approval...`,
  );

  const token = await pollForAccessToken(clientId, clientSecret, device, context);
  context.emitProgress('GitHub authorization successful.');
  return token;
}

type DeviceCodeDetails = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval?: number;
};

async function requestDeviceCode(
  clientId: string,
  context: ExecutionContext,
): Promise<DeviceCodeDetails> {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: 'admin:org read:org',
  });

  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const raw = await safeReadText(response);
    throw fromHttpResponse(response, `Failed to initiate GitHub device authorization: ${raw}`);
  }

  const payload = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };

  if (payload.error) {
    throw new AuthenticationError(
      `GitHub device authorization error: ${payload.error_description ?? payload.error}`,
      { details: { error: payload.error, errorDescription: payload.error_description } },
    );
  }

  if (!payload.device_code || !payload.user_code || !payload.verification_uri || !payload.expires_in) {
    throw new AuthenticationError('GitHub device authorization response was missing required fields.', {
      details: { receivedFields: Object.keys(payload) },
    });
  }

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
    verificationUriComplete: payload.verification_uri_complete,
    expiresIn: payload.expires_in,
    interval: payload.interval,
  };
}

async function pollForAccessToken(
  clientId: string,
  clientSecret: string,
  device: DeviceCodeDetails,
  context: ExecutionContext,
): Promise<{ accessToken: string; scope?: string }> {
  const params = new URLSearchParams({
    client_id: clientId,
    device_code: device.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_secret: clientSecret,
  });

  const timeoutAt = Date.now() + device.expiresIn * 1000;
  let pollIntervalMs = Math.max(0, (device.interval ?? 5) * 1000);

  while (Date.now() < timeoutAt) {
    await delay(pollIntervalMs);

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const raw = await safeReadText(response);
      throw fromHttpResponse(response, `Failed to exchange GitHub device code: ${raw}`);
    }

    const payload = (await response.json()) as {
      access_token?: string;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    };

    if (payload.access_token) {
      context.logger.info('[GitHub] Device authorization approved.');
      return {
        accessToken: payload.access_token,
        scope: payload.scope,
      };
    }

    switch (payload.error) {
      case 'authorization_pending':
        context.emitProgress('Waiting for GitHub authorization approval...');
        continue;
      case 'slow_down':
        pollIntervalMs += 5000;
        context.emitProgress('GitHub asked to slow down polling, increasing interval.');
        continue;
      case 'access_denied':
        throw new PermissionError('GitHub authorization was denied by the user.');
      case 'expired_token':
        throw new TimeoutError('GitHub device authorization expired before approval.', 0);
      default:
        throw new AuthenticationError(
          `GitHub device authorization failed: ${payload.error_description ?? payload.error ?? 'unknown_error'}`,
          { details: { error: payload.error, errorDescription: payload.error_description } },
        );
    }
  }

  throw new TimeoutError('Timed out waiting for GitHub device authorization to complete.', 0);
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
    const searchResponse = await fetch(`https://api.github.com/search/users?q=${query}&per_page=1`, {
      headers,
    });

    if (!searchResponse.ok) {
      const body = await safeReadText(searchResponse);
      throw fromHttpResponse(searchResponse, `Failed to resolve GitHub username for ${trimmed}: ${body}`);
    }

    const payload = await searchResponse.json() as { total_count: number; items: Array<{ login: string }> };

    if (!payload.total_count || payload.items.length === 0) {
      throw new NotFoundError(`No public GitHub user found for email ${trimmed}. Provide a username instead.`, {
        resourceType: 'user',
        resourceId: trimmed,
      });
    }

    const { login } = payload.items[0];
    context.logger.info(`[GitHub] Resolved email ${trimmed} to username ${login}.`);
    return login;
  }

  context.logger.info(`[GitHub] Using provided username ${trimmed}.`);
  return trimmed;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `<<unable to read body: ${(error as Error).message}>>`;
  }
}

componentRegistry.register(definition);
