import { describe, expect, it, vi } from 'bun:test';
import type { ToolExecutionOptions } from 'ai';

import {
  withTaskAwareMcpTools,
  type TaskAwareMcpClient,
  type TaskToolEvent,
} from '../task-aware-mcp-tools';

interface MockTool {
  execute: (input: unknown, options: ToolExecutionOptions) => Promise<unknown>;
  [key: string]: unknown;
}

function createTaskClient(messages: unknown[]): TaskAwareMcpClient {
  return {
    experimental: {
      tasks: {
        callToolStream: () =>
          (async function* () {
            for (const message of messages) {
              yield message;
            }
          })(),
      },
    },
  };
}

describe('withTaskAwareMcpTools', () => {
  it('wraps configured tools and returns final task result', async () => {
    const originalExecute = vi.fn(async (_input: unknown, _options: ToolExecutionOptions) => ({
      legacy: true,
    }));
    const tools: Record<string, MockTool> = {
      run_workflow: {
        execute: originalExecute,
      },
      list_workflows: {
        execute: vi.fn(async (_input: unknown, _options: ToolExecutionOptions) => ({ ok: true })),
      },
    };

    const finalResult = { content: [{ type: 'text', text: 'done' }] };
    const taskClient = createTaskClient([
      { type: 'taskCreated', task: { taskId: 't-1', status: 'working' } },
      { type: 'taskStatus', task: { taskId: 't-1', status: 'working', statusMessage: 'RUNNING' } },
      { type: 'result', result: finalResult },
    ]);

    const events: TaskToolEvent[] = [];
    const wrapped = withTaskAwareMcpTools({
      tools,
      taskClient,
      onTaskEvent: (event) => {
        events.push(event);
      },
    });

    const output = await wrapped.run_workflow.execute({ workflowId: 'wf-1' }, {
      toolCallId: 'call-1',
      messages: [],
    } as ToolExecutionOptions);

    expect(output).toEqual(finalResult);
    expect(originalExecute).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: 'task-created',
        toolName: 'run_workflow',
        toolCallId: 'call-1',
        taskId: 't-1',
        status: 'working',
        statusMessage: undefined,
        pollInterval: undefined,
      },
      {
        type: 'task-status',
        toolName: 'run_workflow',
        toolCallId: 'call-1',
        taskId: 't-1',
        status: 'working',
        statusMessage: 'RUNNING',
        pollInterval: undefined,
      },
    ]);
  });

  it('falls back to original execute when task stream fails and fallback is enabled', async () => {
    const originalExecute = vi.fn(async (_input: unknown, _options: ToolExecutionOptions) => ({
      legacy: true,
    }));
    const tools: Record<string, MockTool> = {
      run_workflow: { execute: originalExecute },
    };

    const taskClient: TaskAwareMcpClient = {
      experimental: {
        tasks: {
          callToolStream: () =>
            (async function* () {
              yield { type: 'error', error: { message: 'tasks unsupported' } };
            })(),
        },
      },
    };

    const wrapped = withTaskAwareMcpTools({
      tools,
      taskClient,
      fallbackToOriginal: true,
    });

    const output = await wrapped.run_workflow.execute({ workflowId: 'wf-2' }, {
      toolCallId: 'call-2',
      messages: [],
    } as ToolExecutionOptions);

    expect(output).toEqual({ legacy: true });
    expect(originalExecute).toHaveBeenCalledTimes(1);
  });

  it('throws when task stream fails and fallback is disabled', async () => {
    const tools: Record<string, MockTool> = {
      run_workflow: {
        execute: vi.fn(async (_input: unknown, _options: ToolExecutionOptions) => ({
          legacy: true,
        })),
      },
    };

    const taskClient: TaskAwareMcpClient = {
      experimental: {
        tasks: {
          callToolStream: () =>
            (async function* () {
              yield { type: 'error', error: { message: 'boom' } };
            })(),
        },
      },
    };

    const wrapped = withTaskAwareMcpTools({
      tools,
      taskClient,
      fallbackToOriginal: false,
    });

    await expect(
      wrapped.run_workflow.execute({ workflowId: 'wf-3' }, {
        toolCallId: 'call-3',
        messages: [],
      } as ToolExecutionOptions),
    ).rejects.toThrow('boom');
  });

  it('does not wrap non-configured tools', async () => {
    const listWorkflowsExecute = vi.fn(async (_input: unknown, _options: ToolExecutionOptions) => ({
      ok: true,
    }));
    const tools: Record<string, MockTool> = {
      run_workflow: {
        execute: vi.fn(async (_input: unknown, _options: ToolExecutionOptions) => ({ ok: true })),
      },
      list_workflows: {
        execute: listWorkflowsExecute,
      },
    };

    const wrapped = withTaskAwareMcpTools({
      tools,
      taskClient: createTaskClient([]),
      toolNames: ['run_workflow'],
    });

    const output = await wrapped.list_workflows.execute({}, {
      toolCallId: 'call-list',
      messages: [],
    } as ToolExecutionOptions);

    expect(output).toEqual({ ok: true });
    expect(listWorkflowsExecute).toHaveBeenCalledTimes(1);
  });

  it('aborts task-backed tools promptly and best-effort cancels the remote task', async () => {
    const originalExecute = vi.fn(async (_input: unknown, _options: ToolExecutionOptions) => ({
      legacy: true,
    }));
    const cancelTask = vi.fn(async (_taskId: string) => undefined);
    const tools: Record<string, MockTool> = {
      run_workflow: {
        execute: originalExecute,
      },
    };

    const taskClient: TaskAwareMcpClient = {
      experimental: {
        tasks: {
          callToolStream: (_params, _schema, streamOptions) =>
            (async function* () {
              yield { type: 'taskCreated', task: { taskId: 't-cancel', status: 'working' } };
              await new Promise<never>((_, reject) => {
                streamOptions?.signal?.addEventListener(
                  'abort',
                  () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
                  { once: true },
                );
              });
            })(),
          cancelTask,
        },
      },
    };

    const wrapped = withTaskAwareMcpTools({
      tools,
      taskClient,
      fallbackToOriginal: false,
    });

    const abortController = new AbortController();
    const execution = wrapped.run_workflow.execute({ workflowId: 'wf-cancel' }, {
      toolCallId: 'call-cancel',
      messages: [],
      abortSignal: abortController.signal,
    } as ToolExecutionOptions);

    await Bun.sleep(0);
    abortController.abort();

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelTask).toHaveBeenCalledWith('t-cancel');
    expect(originalExecute).not.toHaveBeenCalled();
  });
});
