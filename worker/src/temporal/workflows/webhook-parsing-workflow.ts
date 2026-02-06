import { proxyActivities } from '@temporalio/workflow';
import type { ExecuteWebhookParsingScriptActivityInput } from '../activities/webhook-parsing.activity';

function getWebhookParsingActivities(timeoutSeconds?: number) {
  // Keep this deterministic and bounded. A user parsing script that fails permanently (syntax/runtime)
  // should fail fast rather than retrying indefinitely and blocking webhook delivery processing.
  const seconds = Math.max(1, Math.min(timeoutSeconds ?? 120, 10 * 60));

  return proxyActivities<{
    executeWebhookParsingScriptActivity: (
      input: ExecuteWebhookParsingScriptActivityInput,
    ) => Promise<Record<string, unknown>>;
  }>({
    startToCloseTimeout: `${seconds} seconds`,
    scheduleToCloseTimeout: `${seconds} seconds`,
    retry: { maximumAttempts: 1 },
  });
}

export interface WebhookParsingWorkflowInput {
  parsingScript: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  timeoutSeconds?: number;
}

export async function webhookParsingWorkflow(
  input: WebhookParsingWorkflowInput,
): Promise<Record<string, unknown>> {
  const { executeWebhookParsingScriptActivity } = getWebhookParsingActivities(input.timeoutSeconds);
  return executeWebhookParsingScriptActivity(input);
}
