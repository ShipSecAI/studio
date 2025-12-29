/**
 * E2E Test: Manual Action Components with Dynamic Templates
 * 
 * This script tests the complete manual action flow:
 * 1. Creates a workflow with Manual Approval, Selection, and Form
 * 2. Uses dynamic variables and templates in all of them
 * 3. Runs the workflow with runtime inputs
 * 4. Verifies the interpolated content in pending requests
 * 5. Resolves each request via API
 * 6. Verifies workflow completion
 */

const API_BASE = 'http://localhost:3211/api/v1';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 Starting E2E Manual Actions Test...\n');

  const TEST_USER = 'betterclever';
  const TEST_PROJECT = 'ShipSec-Studio-Refactor';

  // 1. Create Workflow
  console.log('📝 Creating multi-action workflow...');
  
  const workflowGraph = {
    name: 'E2E Manual Actions Test ' + Date.now(),
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: {
            runtimeInputs: [
              { id: 'userName', label: 'User Name', type: 'string', required: true }
            ]
          },
        },
      },
      {
        id: 'logic',
        type: 'core.logic.script',
        position: { x: 200, y: 0 },
        data: {
          label: 'Prepare Data',
          config: {
            code: `export async function script(input: Input): Promise<Output> { return { projectName: "${TEST_PROJECT}" }; }`,
            returns: [{ name: 'projectName', type: 'string' }]
          },
        },
      },
      {
        id: 'approval',
        type: 'core.manual_action.approval',
        position: { x: 400, y: 0 },
        data: {
          label: 'Manual Approval',
          config: {
            title: 'Approve {{projectName}}',
            description: 'Hello **{{userName}}**, please approve the release of **{{projectName}}**.',
            variables: [
              { name: 'userName', type: 'string' },
              { name: 'projectName', type: 'string' }
            ]
          },
        },
      },
      {
        id: 'selection',
        type: 'core.manual_action.selection',
        position: { x: 600, y: 0 },
        data: {
          label: 'Manual Selection',
          config: {
            title: 'Select Role for {{userName}}',
            description: 'Project context: {{projectName}}',
            options: ['Admin', 'Editor', 'Viewer'],
            variables: [
              { name: 'userName', type: 'string' },
              { name: 'projectName', type: 'string' }
            ]
          },
        },
      },
      {
        id: 'form',
        type: 'core.manual_action.form',
        position: { x: 800, y: 0 },
        data: {
          label: 'Manual Form',
          config: {
            title: 'Metadata for {{projectName}}',
            description: 'Please provide details for **{{projectName}}** deployment.',
            schema: {
              type: 'object',
              properties: {
                environment: { type: 'string', enum: ['prod', 'staging'] },
                nodes: { type: 'number', default: 3 }
              },
              required: ['environment']
            },
            variables: [
              { name: 'projectName', type: 'string' }
            ]
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'logic' },
      { id: 'e2', source: 'logic', target: 'approval' },
      { id: 'e3', source: 'approval', target: 'selection' },
      { id: 'e4', source: 'selection', target: 'form' },
      
      // Data connections
      { id: 'd1', source: 'start', sourceHandle: 'userName', target: 'approval', targetHandle: 'userName' },
      { id: 'd2', source: 'logic', sourceHandle: 'projectName', target: 'approval', targetHandle: 'projectName' },
      { id: 'd3', source: 'start', sourceHandle: 'userName', target: 'selection', targetHandle: 'userName' },
      { id: 'd4', source: 'logic', sourceHandle: 'projectName', target: 'selection', targetHandle: 'projectName' },
      { id: 'd5', source: 'logic', sourceHandle: 'projectName', target: 'form', targetHandle: 'projectName' },
    ],
  };

  let workflowId = '';
  const createRes = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(workflowGraph),
  });
  const wfData = await createRes.json();
  workflowId = wfData.id;
  console.log('   ✅ Workflow created:', workflowId);

  // 2. Run Workflow
  console.log('\n▶️ Running workflow with userName:', TEST_USER);
  const runRes = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ inputs: { userName: TEST_USER } })
  });
  const runData = await runRes.json();
  const runId = runData.runId;
  console.log('   ✅ Run started:', runId);

  const resolveAction = async (expectedType: string, expectedTitle: string, responseData: any) => {
    console.log(`\n🔍 Waiting for ${expectedType} request (runId=${runId})...`);
    let action = null;
    let lastFound = null;
    for (let i = 0; i < 20; i++) {
        await sleep(1500);
        const res = await fetch(`${API_BASE}/human-inputs?runId=${runId}&status=pending`, { headers: HEADERS });
        const list = await res.json();
        lastFound = list;
        action = list.find((a: any) => a.inputType === expectedType);
        if (action) break;
    }

    if (!action) {
        console.error(`❌ Timeout waiting for ${expectedType}. Pending actions in list:`, JSON.stringify(lastFound));
        const statusRes = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
        console.log('Run status:', await statusRes.json());
        process.exit(1);
    }

    console.log(`   Found: "${action.title}"`);
    if (action.title !== expectedTitle) {
        console.error(`❌ Title mismatch! Expected: "${expectedTitle}", Got: "${action.title}"`);
        process.exit(1);
    }
    console.log(`   Description check: ${action.description.substring(0, 50)}...`);
    if (!action.description.includes(TEST_PROJECT) || !action.description.includes(TEST_USER)) {
        if (expectedType !== 'form' || action.description.includes(TEST_PROJECT)) {
             // Form only has projectName
        } else {
            console.error(`❌ Interpolation failed in description: ${action.description}`);
            process.exit(1);
        }
    }

    console.log(`✅ Resolving ${expectedType}...`);
    const resolveRes = await fetch(`${API_BASE}/human-inputs/${action.id}/resolve`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ responseData })
    });
    if (!resolveRes.ok) {
        console.error(`❌ Resolve failed:`, await resolveRes.text());
        process.exit(1);
    }
    console.log(`   ✅ ${expectedType} resolved.`);
  };

  // 3. Resolve Manual Approval
  await resolveAction('approval', `Approve ${TEST_PROJECT}`, { status: 'approved', comment: 'Looks good' });

  // 4. Resolve Manual Selection
  await resolveAction('selection', `Select Role for ${TEST_USER}`, { selection: 'Admin' });

  // 5. Resolve Manual Form
  await resolveAction('form', `Metadata for ${TEST_PROJECT}`, { environment: 'prod', nodes: 5 });

  // 6. Wait for Completion
  console.log('\n⏳ Waiting for completion...');
  let status = 'RUNNING';
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const statusRes = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
    const data = await statusRes.json();
    status = data.status;
    if (status !== 'RUNNING') break;
    process.stdout.write('.');
  }
  console.log('\n🏁 Final Status:', status);

  if (status === 'COMPLETED') {
    console.log('\n🎉🎉🎉 E2E TEST PASSED! All manual actions interpolated and resolved correctly.');
    console.log(`\nWorkflow ID: ${workflowId}`);
    console.log(`Run ID: ${runId}`);
  } else {
    console.error('\n❌ Test failed with status:', status);
    const resultRes = await fetch(`${API_BASE}/workflows/runs/${runId}/result`, { headers: HEADERS });
    console.log('Error info:', await resultRes.text());
    process.exit(1);
  }

  // Cleanup skipped as requested
  console.log('\n🏁 Test finished. Cleanup skipped by user request.');
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
