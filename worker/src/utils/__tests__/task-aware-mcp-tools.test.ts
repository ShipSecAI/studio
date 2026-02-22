import { describe, expect, it, vi } from 'bun:test';
import type { ToolExecutionOptions } from 'ai';

import {
  withTaskAwareMcpTools,
  type TaskAwareMcpClient,
  type TaskToolEvent,
} from '../task-aware-mcp-tools';

interface MockTool {
  execute: (input: unknown, options: ToolExecutionOptions) => Promise<unknown>;
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
});
