import { proxyActivities } from '@temporalio/workflow';
import type { RunWorkflowActivityInput, RunWorkflowActivityOutput } from '../types';

// Proxy for activities (no implementation here, handled by worker)
const { runWorkflowActivity } = proxyActivities<{
  runWorkflowActivity(input: RunWorkflowActivityInput): Promise<RunWorkflowActivityOutput>;
}>({
  startToCloseTimeout: '10 minutes',
});

/**
 * Main ShipSec workflow that executes a compiled DSL definition
 */
export async function shipsecWorkflowRun(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  console.log(`[Workflow] Starting shipsec workflow run: ${input.runId}`);
  return await runWorkflowActivity(input);
}

/**
 * Minimal test workflow
 */
export async function minimalWorkflow(): Promise<string> {
  return 'minimal workflow executed successfully';
}

/**
 * Test workflow with activity
 */
export async function testMinimalWorkflow(input: RunWorkflowActivityInput): Promise<RunWorkflowActivityOutput> {
  console.log(`[Workflow] Test workflow starting for run: ${input.runId}`);
  return await runWorkflowActivity(input);
}


