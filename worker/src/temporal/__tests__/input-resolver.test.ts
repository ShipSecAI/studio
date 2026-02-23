import { describe, expect, it } from 'bun:test';
import { buildActionPayload } from '../input-resolver';
import type { WorkflowAction } from '../types';

function makeAction(overrides: Partial<WorkflowAction> = {}): WorkflowAction {
  return {
    ref: 'node-1',
    componentId: 'test.component',
    params: {},
    inputOverrides: {},
    dependsOn: [],
    inputMappings: {},
    ...overrides,
  };
}

describe('buildActionPayload template resolution', () => {
  it('resolves direct upstream template references in inputOverrides', () => {
    const action = makeAction({
      inputOverrides: {
        domains: '{{entry.domain}}',
      },
    });

    const { inputs } = buildActionPayload(action, new Map([['entry', { domain: 'shipsec.ai' }]]));
    expect(inputs.domains).toBe('shipsec.ai');
  });

  it('supports legacy entry.runtimeInputs.* references', () => {
    const action = makeAction({
      inputOverrides: {
        domains: '{{entry.runtimeInputs.domain}}',
      },
    });

    const { inputs } = buildActionPayload(action, new Map([['entry', { domain: 'shipsec.ai' }]]));
    expect(inputs.domains).toBe('shipsec.ai');
  });

  it('leaves unknown placeholders intact (e.g. secret refs)', () => {
    const action = makeAction({
      params: {
        token: '{{secret:abc123}}',
      },
    });

    const { params } = buildActionPayload(action, new Map([['entry', { domain: 'shipsec.ai' }]]));
    expect(params.token).toBe('{{secret:abc123}}');
  });

  it('resolves mixed string templates when source refs exist', () => {
    const action = makeAction({
      params: {
        message: 'scan {{entry.domain}} now',
      },
    });

    const { params } = buildActionPayload(action, new Map([['entry', { domain: 'shipsec.ai' }]]));
    expect(params.message).toBe('scan shipsec.ai now');
  });
});
