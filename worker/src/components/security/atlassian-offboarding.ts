import { z } from 'zod';
import {
  componentRegistry,
  type ComponentDefinition,
  ComponentRetryPolicy,
  port,
  ValidationError,
  ConfigurationError,
  NetworkError,
  fromHttpResponse,
} from '@shipsec/component-sdk';

const emailUsernameArraySchema = z
  .array(z.string().min(1, 'Email username cannot be empty'))
  .min(1, 'Provide at least one email username to offboard');

const inputSchema = z.object({
  orgId: z.string().min(1, 'Organization ID is required'),
  emailUsernames: z
    .preprocess(value => {
      if (Array.isArray(value)) {
        return value;
      }
      if (typeof value === 'string') {
        return value
          .split(/[\r\n,]+/)
          .map(item => item.trim())
          .filter(item => item.length > 0);
      }
      return value;
    }, emailUsernameArraySchema)
    .describe('Email usernames (portion before @) to remove from the organization'),
  accessToken: z
    .string()
    .min(1, 'Access token is required')
    .describe('Resolved Atlassian admin API bearer token (connect via Secret Loader).'),
  limit: z
    .number()
    .int({ message: 'Limit must be an integer' })
    .positive('Limit must be a positive integer')
    .max(200, 'Limit cannot exceed 200')
    .default(20)
    .optional()
    .describe('Maximum number of users to return from search'),
});

type Input = z.infer<typeof inputSchema>;

const resultSchema = z.object({
  emailUsername: z.string(),
  accountId: z.string().nullable(),
  status: z.enum(['deleted', 'not_found', 'error']),
  message: z.string().optional(),
});

type Result = z.infer<typeof resultSchema>;

type Output = {
  orgId: string;
  requestedEmails: string[];
  results: Result[];
  summary: {
    requested: number;
    found: number;
    deleted: number;
    failed: number;
  };
  searchRaw?: unknown;
};

const outputSchema = z.object({
  orgId: z.string(),
  requestedEmails: z.array(z.string()),
  results: z.array(resultSchema),
  summary: z.object({
    requested: z.number(),
    found: z.number(),
    deleted: z.number(),
    failed: z.number(),
  }),
  searchRaw: z.unknown().optional(),
});

function normaliseAccountId(candidate: unknown): string | undefined {
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return undefined;
}

function extractAccountId(entry: Record<string, unknown>): string | undefined {
  return (
    normaliseAccountId(entry.accountId) ??
    normaliseAccountId(entry.account_id) ??
    normaliseAccountId(entry.id)
  );
}

function extractEmailUsername(entry: Record<string, unknown>): string | undefined {
  const candidates = [
    entry.emailUsername,
    entry.email_user_name,
    entry.username,
    entry.email,
    entry.emailAddress,
    entry.primaryEmail,
    entry.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const value = candidate.trim();
    if (!value) {
      continue;
    }
    const atIndex = value.indexOf('@');
    if (atIndex > 0) {
      return value.slice(0, atIndex).toLowerCase();
    }
    return value.toLowerCase();
  }

  return undefined;
}

function safeLower(value: string): string {
  return value.trim().toLowerCase();
}

function normaliseEmailUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const atIndex = trimmed.indexOf('@');
  const username = atIndex > 0 ? trimmed.slice(0, atIndex) : trimmed;
  return username.toLowerCase();
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2000);
  } catch (error) {
    return `Failed to read response body: ${(error as Error).message}`;
  }
}

function getSearchResults(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }

  const objectPayload = payload as Record<string, unknown>;
  const keys = ['data', 'values', 'results', 'users'];

  for (const key of keys) {
    const value = objectPayload[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }
  }

  return [];
}

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.atlassian.offboarding',
  label: 'Atlassian Offboarding',
  category: 'it_ops',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs:
    'Search for Atlassian accounts by email username and remove them from an organization using the Atlassian Admin API. Typical workflow: Secret Fetch → Atlassian Offboarding → Console Log / Notify.\n\nPrerequisites:\n- Atlassian organization ID (UUID) with admin API access.\n- Admin API bearer token delivered via Secret Fetch (connect the secret output to the accessToken input).\n\nInputs:\n- emailUsernames: comma/newline separated list or array of email usernames (portion before @).\n- orgId: Atlassian organization identifier.\n- accessToken: bearer token supplied via a secret/credential port.\n\nOutputs:\n- results: entry for each requested username including accountId, status, and message.\n- summary: aggregate counts (requested/found/deleted/failed).\n- searchRaw: raw API response for audit/debug.\n\nSee docs/atlassian-offboarding.md for end-to-end workflow guidance.',
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError', 'NotFoundError'],
  } satisfies ComponentRetryPolicy,
  metadata: {
    slug: 'atlassian-offboarding',
    version: '1.0.0',
    type: 'process',
    category: 'it_ops',
    description:
      'Automate Atlassian user offboarding by chaining Secret Fetch (token) → Atlassian Offboarding (remove accounts) → Console Log/Notify. Supports bulk email usernames and returns structured results.',
    documentation: 'docs/atlassian-offboarding.md',
    icon: 'UserMinus',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'emailUsernames',
        label: 'Email Usernames',
        dataType: port.list(port.text()),
        required: true,
        description:
          'Email usernames (portion before the @) separated by commas or new lines to remove from the organization.',
        valuePriority: 'manual-first',
      },
      {
        id: 'orgId',
        label: 'Organization ID',
        dataType: port.text(),
        required: true,
        description: 'Atlassian organization identifier (UUID).',
        valuePriority: 'manual-first',
      },
      {
        id: 'accessToken',
        label: 'Access Token',
        dataType: port.secret(),
        required: true,
        description: 'Bearer token with admin scope (connect from Secret Fetch to keep credentials masked).',
        valuePriority: 'connection-first',
      },
    ],
    outputs: [
      {
        id: 'results',
        label: 'Offboarding Results',
        dataType: port.list(port.json()),
        description: 'Status of each requested user offboarding attempt.',
      },
      {
        id: 'summary',
        label: 'Summary',
        dataType: port.json(),
        description: 'Aggregate statistics for the run.',
      },
      {
        id: 'searchRaw',
        label: 'Raw Search Response',
        dataType: port.json(),
        description: 'Unmodified search API payload for debugging.',
      },
    ],
    parameters: [
      {
        id: 'orgId',
        label: 'Organization ID',
        type: 'text',
        required: true,
        default: 'b51b44a1-b614-4cfc-9b58-daeced73dede',
        placeholder: 'b51b44a1-b614-4cfc-9b58-daeced73dede',
        description: 'Atlassian organization identifier.',
      },
      {
        id: 'emailUsernames',
        label: 'Email Usernames',
        type: 'textarea',
        required: true,
        default: 'abhishek0908',
        rows: 4,
        description: 'Enter one email username or email address per line.',
        helpText: 'Example: abhishekudiya09 or abhishekudiya09@example.com',
      },
      {
        id: 'limit',
        label: 'Search Limit',
        type: 'number',
        required: false,
        default: 20,
        min: 1,
        max: 200,
        description: 'Maximum number of users to return from the search API.',
      },
    ],
  },
  async execute(params, context) {
    const { orgId, limit = 20 } = params;
    context.logger.info(
      `[AtlassianOffboarding] Starting offboarding workflow for org ${orgId} with search limit ${limit}.`,
    );

    const requestedEmails = params.emailUsernames
      .map(normaliseEmailUsername)
      .filter((value): value is string => Boolean(value));

    const requestedUsernames = Array.from(new Set(requestedEmails));

    if (requestedUsernames.length === 0) {
      throw new ValidationError('No valid email usernames provided after trimming input.', {
        fieldErrors: { emailUsernames: ['At least one valid email username is required'] },
      });
    }

    context.logger.info(
      `[AtlassianOffboarding] Normalised ${requestedUsernames.length} username(s): ${requestedUsernames.join(', ')}`,
    );

    const accessToken = params.accessToken.trim();
    if (!accessToken) {
      throw new ConfigurationError('Access token is required to call the Atlassian Admin API.', {
        configKey: 'accessToken',
      });
    }
    context.logger.info('[AtlassianOffboarding] Using access token provided via secret input.');

    context.emitProgress(`Searching Atlassian for ${requestedUsernames.length} user(s) to offboard...`);
    context.logger.info(
      `[AtlassianOffboarding] Initiating search in org ${orgId} for usernames: ${requestedUsernames.join(', ')}`,
    );

    const searchPayload = {
      limit,
      emailUsernames: {
        eq: requestedUsernames,
      },
    };
    context.logger.info(
      `[AtlassianOffboarding] Search payload prepared with limit ${limit} and ${requestedUsernames.length} username(s).`,
    );

    let searchResponse: Response;
    const searchStartedAt = Date.now();
    try {
      searchResponse = await fetch(`https://api.atlassian.com/admin/v1/orgs/${orgId}/users/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchPayload),
      });
      context.logger.info(
      `[AtlassianOffboarding] Output of ${searchResponse}`,
    );
    } catch (error) {
      const message = (error as Error).message ?? 'Unknown error';
      context.logger.error(`[AtlassianOffboarding] Search request failed: ${message}`);
      throw new NetworkError(`Failed to call Atlassian search API: ${message}`, {
        cause: error as Error,
      });
    }

    const searchDuration = Date.now() - searchStartedAt;
    context.logger.info(
      `[AtlassianOffboarding] Search API responded with status ${searchResponse.status} in ${searchDuration}ms.`,
    );

    if (!searchResponse.ok) {
      const bodySnippet = await readResponseBody(searchResponse);
      context.logger.error(
        `[AtlassianOffboarding] Atlassian search API returned ${searchResponse.status}: ${searchResponse.statusText}`,
      );
      throw fromHttpResponse(searchResponse, `Atlassian search API error: ${bodySnippet}`);
    }

    let searchPayloadJson: unknown;
    try {
      searchPayloadJson = await searchResponse.json();
       context.logger.info(
      `[AtlassianOffboarding] Search API responded with json ${searchPayloadJson}`,
    );
    } catch (error) {
      const message = (error as Error).message ?? 'Unknown error';
      context.logger.error(`[AtlassianOffboarding] Failed to parse search response JSON: ${message}`);
      throw new ValidationError(`Unable to parse Atlassian search response JSON: ${message}`, {
        cause: error as Error,
        details: { operation: 'parseSearchResponse' },
      });
    }

    const searchResults = getSearchResults(searchPayloadJson);
    context.logger.info(
      `[AtlassianOffboarding] Search returned ${searchResults.length} result(s) for ${requestedUsernames.length} requested user(s).`,
    );
    context.emitProgress(`Located ${searchResults.length} matching account(s) in Atlassian.`);

    const matches = new Map<string, Record<string, unknown>[]>();
    const unmatchedEntries: Record<string, unknown>[] = [];
    for (const entry of searchResults) {
      const username = extractEmailUsername(entry);
      if (!username) {
        unmatchedEntries.push(entry);
        continue;
      }
      const byEmail = matches.get(username) ?? [];
      byEmail.push(entry);
      matches.set(username, byEmail);
    }
    context.logger.info(
      `[AtlassianOffboarding] Aggregated matches across ${matches.size} username bucket(s); unmatched entries available: ${unmatchedEntries.length}.`,
    );

    const results: Result[] = [];
    const deletedAccountIds = new Set<string>();

    for (const emailUsername of requestedUsernames) {
      const lower = safeLower(emailUsername);
      const candidateEntries = matches.get(lower) ?? [];
      const candidateCount = candidateEntries.length;
      const entryFromMatches = candidateEntries.shift();
      if (candidateEntries.length > 0) {
        matches.set(lower, candidateEntries);
      } else {
        matches.delete(lower);
      }
      const entry = entryFromMatches ?? unmatchedEntries.shift();
      context.logger.info(
        `[AtlassianOffboarding] Candidate matches for ${emailUsername}: ${candidateCount}, assigned entry: ${
          entry ? 'yes' : 'no'
        }.`,
      );
      const accountId = entry ? extractAccountId(entry) : undefined;

      if (!entry || !accountId) {
        context.logger.info(
          `[AtlassianOffboarding] No Atlassian account found for username ${emailUsername} in org ${orgId}.`,
        );
        results.push({
          emailUsername,
          accountId: null,
          status: 'not_found',
          message: 'No matching Atlassian account returned by search API.',
        });
        continue;
      }

      if (deletedAccountIds.has(accountId)) {
        context.logger.info(
          `[AtlassianOffboarding] Account ${accountId} already processed earlier in this run, skipping duplicate.`,
        );
        results.push({
          emailUsername,
          accountId,
          status: 'deleted',
          message: 'Account already deleted earlier in this run.',
        });
        continue;
      }

      context.emitProgress(`Removing Atlassian user ${emailUsername} (${accountId}) from organization...`);
      context.logger.info(
        `[AtlassianOffboarding] Attempting to delete user ${emailUsername} with accountId ${accountId}`,
      );

      let deleteResponse: Response;
      try {
        deleteResponse = await fetch(
          `https://api.atlassian.com/admin/v1/orgs/${orgId}/directory/users/${accountId}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
        );
      } catch (error) {
        const message = (error as Error).message ?? 'Unknown error';
        context.logger.error(
          `[AtlassianOffboarding] Failed to delete account ${accountId} (${emailUsername}): ${message}`,
        );
        results.push({
          emailUsername,
          accountId,
          status: 'error',
          message: `Network error while calling delete API: ${message}`,
        });
        continue;
      }

      if (!deleteResponse.ok) {
        const bodySnippet = await readResponseBody(deleteResponse);
        context.logger.error(
          `[AtlassianOffboarding] Delete API returned ${deleteResponse.status} for account ${accountId}.`,
        );
        results.push({
          emailUsername,
          accountId,
          status: 'error',
          message: `Failed to delete account. Status ${deleteResponse.status}: ${deleteResponse.statusText}. Body: ${bodySnippet}`,
        });
        continue;
      }

      deletedAccountIds.add(accountId);
      context.logger.info(
        `[AtlassianOffboarding] Successfully removed account ${accountId} for username ${emailUsername}.`,
      );

      results.push({
        emailUsername,
        accountId,
        status: 'deleted',
      });
    }

    const summary = {
      requested: requestedUsernames.length,
      found: results.filter(result => result.accountId !== null).length,
      deleted: results.filter(result => result.status === 'deleted').length,
      failed: results.filter(result => result.status === 'error').length,
    };

    if (summary.failed > 0) {
      context.logger.error(
        `[AtlassianOffboarding] Completed with ${summary.failed} failure(s) out of ${summary.requested} requested.`,
      );
    } else {
      context.logger.info(
        `[AtlassianOffboarding] Completed offboarding for ${summary.deleted}/${summary.requested} requested usernames.`,
      );
    }
    context.logger.info(
      `[AtlassianOffboarding] Summary -> requested: ${summary.requested}, found: ${summary.found}, deleted: ${summary.deleted}, failed: ${summary.failed}.`,
    );

    return {
      orgId,
      requestedEmails: requestedUsernames,
      results,
      summary,
      searchRaw: searchPayloadJson,
    };
  },
};

componentRegistry.register(definition);
