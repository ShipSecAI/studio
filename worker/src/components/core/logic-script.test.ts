import { describe, expect, it } from 'bun:test';
import { definition } from './logic-script';
import { type ExecutionContext } from '@shipsec/component-sdk';

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
  metadata: {
    runId: 'test-run',
    componentRef: 'test-node',
  },
};

describe('Logic/Script Component', () => {
  it('executes simple JavaScript math', async () => {
    const result = await definition.execute({
      code: 'export async function script() { return { sum: 1 + 2 }; }',
      variables: [],
      returns: [{ name: 'sum', type: 'number' }],
    }, mockContext);

    expect(result).toEqual({ sum: 3 });
  });

  it('transpiles and executes TypeScript', async () => {
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
      code: tsCode,
      variables: [],
      returns: [{ name: 'msg', type: 'string' }],
    }, mockContext);

    expect(result).toEqual({ msg: 'Value is 10' });
  });

  it('accepts input variables and returns outputs', async () => {
    const result = await definition.execute({
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
      x: 10,
      y: 4,
    } as any, mockContext);

    expect(result).toEqual({ diff: 6, product: 40 });
  });

  it('can access global fetch', async () => {
    const code = `
      export async function script() {
        const res = await fetch('https://www.google.com');
        return { status: res.status };
      }
    `;

    const result = await definition.execute({
      code,
      variables: [],
      returns: [{ name: 'status', type: 'number' }],
    }, mockContext);

    expect(result.status).toBe(200);
  });
  
  it('correctly resolves ports', () => {
    const params = {
        code: '',
        variables: [{ name: 'in1', type: 'string' }],
        returns: [{ name: 'out1', type: 'boolean' }],
    };
    // @ts-ignore
    const ports = definition.resolvePorts(params);
    
    expect(ports.inputs).toHaveLength(1);
    expect(ports.inputs![0].id).toBe('in1');
    expect((ports.inputs![0].dataType as any).name).toBe('text');
    
    expect(ports.outputs).toHaveLength(1);
    expect(ports.outputs![0].id).toBe('out1');
    expect((ports.outputs![0].dataType as any).name).toBe('boolean');
  });

});
