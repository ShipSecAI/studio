/**
 * Cleanup Script for E2E Tests
 *
 * Removes test workflows and runs created during E2E testing.
 * This keeps the workspace clean and prevents test artifact accumulation.
 */

const API_BASE = 'http://localhost:3211/api/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

const TEST_WORKFLOW_PREFIX = 'Test:';
const TEST_CLEANUP_DELAY_MS = 1000; // Delay before cleanup to allow final reads

/**
 * Fetch all workflows
 */
async function getWorkflows() {
  const res = await fetch(`${API_BASE}/workflows`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch workflows: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch runs for a specific workflow
 */
async function getWorkflowRuns(workflowId: string) {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/runs`, { headers: HEADERS });
  if (!res.ok) {
    console.warn(`Failed to fetch runs for workflow ${workflowId}: ${res.status}`);
    return [];
  }
  return res.json();
}

/**
 * Delete a workflow (and all its runs)
 */
async function deleteWorkflow(workflowId: string, workflowName: string) {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}`, {
    method: 'DELETE',
    headers: HEADERS,
  });

  if (res.ok) {
    console.log(`  ✓ Deleted: ${workflowName}`);
  } else if (res.status === 404) {
    console.warn(`  ⊘ Not found: ${workflowName} (already deleted)`);
  } else {
    console.warn(`  ✗ Failed to delete: ${workflowName} (${res.status})`);
  }
}

/**
 * Main cleanup function
 */
async function cleanup() {
  console.log('🧹 E2E Test Cleanup');
  console.log('');

  try {
    // Fetch all workflows
    const workflows = await getWorkflows();

    // Filter test workflows (those starting with "Error Test:")
    const testWorkflows = workflows.filter((wf: any) =>
      wf.name?.startsWith(TEST_WORKFLOW_PREFIX)
    );

    if (testWorkflows.length === 0) {
      console.log('✨ No test workflows found - workspace is clean');
      return;
    }

    console.log(`Found ${testWorkflows.length} test workflow(s):`);

    // Delete each test workflow
    for (const workflow of testWorkflows) {
      await deleteWorkflow(workflow.id, workflow.name);
    }

    console.log('');
    console.log(`✨ Cleanup complete - deleted ${testWorkflows.length} test workflow(s)`);

  } catch (error) {
    console.error('');
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Run cleanup
cleanup().catch(error => {
  console.error('Fatal error during cleanup:', error);
  process.exit(1);
});
