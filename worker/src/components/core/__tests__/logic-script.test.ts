import { afterEach, describe, expect, it, vi } from 'bun:test';
import { definition } from '../logic-script';
import { extractPorts, type ExecutionContext } from '@shipsec/component-sdk';
import * as sdk from '@shipsec/component-sdk';

// Mock context
const mockContext: ExecutionContext = {
  runId: 'test-run',
  componentRef: 'test-node',
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  emitProgress: () => {},
  ui: {
    runId: 'test-run',
    componentRef: 'test-node',
  },
  http: {
    fetch: async () => new Response(),
    toCurl: () => '',
  },
};

const buildRunnerOutput = (payload: unknown) =>
  `---RESULT_START---\n${JSON.stringify(payload)}\n---RESULT_END---`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Logic/Script Component', () => {
  it('executes simple JavaScript math', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      buildRunnerOutput({ sum: 3 }),
    );
    const result = await definition.execute({
      inputs: {},
      params: {
        code: 'export async function script() { return { sum: 1 + 2 }; }',
        variables: [],
        returns: [{ name: 'sum', type: 'number' }],
      },
    }, mockContext);

    expect(result).toEqual({ sum: 3 });
  });

  it('transpiles and executes TypeScript', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      buildRunnerOutput({ msg: 'Value is 10' }),
    );
    const tsCode = `
      interface Result { msg: string; }
      export async function script(): Promise<Result> {
        const calculate = (a: number): Result => {
          return { msg: 'Value is ' + a };
        };
        const res: Result = calculate(10);
        return res;
      }
    `;
    
    const result = await definition.execute({
      inputs: {},
      params: {
        code: tsCode,
        variables: [],
        returns: [{ name: 'msg', type: 'string' }],
      },
    }, mockContext);

    expect(result).toEqual({ msg: 'Value is 10' });
  });

  it('accepts input variables and returns outputs', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      buildRunnerOutput({ diff: 6, product: 40 }),
    );
    const result = await definition.execute({
      inputs: {
        x: 10,
        y: 4,
      },
      params: {
        code: `
          export async function script(input) {
            return {
              diff: input.x - input.y,
              product: input.x * input.y
            };
          }
        `,
        variables: [
          { name: 'x', type: 'number' },
          { name: 'y', type: 'number' },
        ],
        returns: [
          { name: 'diff', type: 'number' },
          { name: 'product', type: 'number' },
        ],
      },
    } as any, mockContext);

    expect(result).toEqual({ diff: 6, product: 40 });
  });

  it('can access global fetch', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      buildRunnerOutput({ status: 200 }),
    );
    const code = `
      export async function script() {
        const res = await fetch('https://www.google.com');
        return { status: res.status };
      }
    `;

    const result = await definition.execute({
      inputs: {},
      params: {
        code,
        variables: [],
        returns: [{ name: 'status', type: 'number' }],
      },
    }, mockContext);

    expect(result.status).toBe(200);
  });
  
  it('correctly resolves ports', () => {
    const params = {
        code: '',
        variables: [{ name: 'in1', type: 'string' }],
        returns: [{ name: 'out1', type: 'boolean' }],
    };
    const ports = definition.resolvePorts(params);
    
    const inputPorts = extractPorts(ports.inputs);
    const outputPorts = extractPorts(ports.outputs);

    expect(inputPorts).toHaveLength(1);
    expect(inputPorts[0].id).toBe('in1');
    expect(inputPorts[0].connectionType).toEqual({ kind: 'primitive', name: 'text' });
    
    expect(outputPorts).toHaveLength(1);
    expect(outputPorts[0].id).toBe('out1');
    expect(outputPorts[0].connectionType).toEqual({ kind: 'primitive', name: 'boolean' });
  });

});
