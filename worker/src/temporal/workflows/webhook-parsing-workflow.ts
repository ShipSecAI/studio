import { proxyActivities } from '@temporalio/workflow';
import type {
  ExecuteWebhookParsingScriptActivityInput,
} from '../activities/webhook-parsing.activity';

const { executeWebhookParsingScriptActivity } = proxyActivities<{
  executeWebhookParsingScriptActivity: (
    input: ExecuteWebhookParsingScriptActivityInput,
  ) => Promise<Record<string, unknown>>;
}>({
  startToCloseTimeout: '2 minutes',
});

export interface WebhookParsingWorkflowInput {
  parsingScript: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  timeoutSeconds?: number;
}

export async function webhookParsingWorkflow(
  input: WebhookParsingWorkflowInput,
): Promise<Record<string, unknown>> {
  return executeWebhookParsingScriptActivity(input);
}

