import type { ToolExecutionOptions } from 'ai';

interface TaskState {
  taskId: string;
  status: string;
  statusMessage?: string;
  pollInterval?: number;
}

type TaskStreamMessage =
  | { type: 'taskCreated'; task: unknown }
  | { type: 'taskStatus'; task: unknown }
  | { type: 'result'; result: unknown }
  | { type: 'error'; error: unknown };

interface ExecutableTool {
  execute?: (input: unknown, options: ToolExecutionOptions) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

type ToolSetLike = Record<string, ExecutableTool>;

export interface TaskAwareMcpClient {
  experimental: {
    tasks: {
      callToolStream(params: {
        name: string;
        arguments?: Record<string, unknown>;
      }): AsyncIterable<unknown>;
    };
  };
}

export interface TaskToolEvent {
  type: 'task-created' | 'task-status';
  toolName: string;
  toolCallId: string;
  taskId: string;
  status: string;
  statusMessage?: string;
  pollInterval?: number;
}

export interface TaskAwareMcpToolsOptions<TTools extends ToolSetLike> {
  tools: TTools;
  taskClient: TaskAwareMcpClient;
  toolNames?: string[];
  fallbackToOriginal?: boolean;
  onTaskEvent?: (event: TaskToolEvent) => void | Promise<void>;
  onDebug?: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeTaskState(rawTask: unknown): TaskState | null {
  if (!isRecord(rawTask)) return null;
  if (typeof rawTask.taskId !== 'string') return null;
  if (typeof rawTask.status !== 'string') return null;

  return {
    taskId: rawTask.taskId,
    status: rawTask.status,
    statusMessage: typeof rawTask.statusMessage === 'string' ? rawTask.statusMessage : undefined,
    pollInterval: typeof rawTask.pollInterval === 'number' ? rawTask.pollInterval : undefined,
  };
}

function formatTaskError(error: unknown): Error {
  if (error instanceof Error) return error;

  if (isRecord(error) && typeof error.message === 'string') {
    return new Error(error.message);
  }

  return new Error(`MCP task stream failed: ${String(error)}`);
}

async function runTaskTool({
  taskClient,
  toolName,
  input,
  options,
  onTaskEvent,
}: {
  taskClient: TaskAwareMcpClient;
  toolName: string;
  input: unknown;
  options: ToolExecutionOptions;
  onTaskEvent?: (event: TaskToolEvent) => void | Promise<void>;
}): Promise<unknown> {
  const args = isRecord(input) ? input : {};
  let finalResult: unknown;
  let hasFinalResult = false;

  const stream = taskClient.experimental.tasks.callToolStream({
    name: toolName,
    arguments: args,
  });

  for await (const rawMessage of stream) {
    const message = rawMessage as TaskStreamMessage;

    if (message.type === 'taskCreated' || message.type === 'taskStatus') {
      const state = normalizeTaskState(message.task);
      if (!state) continue;

      await onTaskEvent?.({
        type: message.type === 'taskCreated' ? 'task-created' : 'task-status',
        toolName,
        toolCallId: options.toolCallId,
        taskId: state.taskId,
        status: state.status,
        statusMessage: state.statusMessage,
        pollInterval: state.pollInterval,
      });
      continue;
    }

    if (message.type === 'result') {
      finalResult = message.result;
      hasFinalResult = true;
      break;
    }

    if (message.type === 'error') {
      throw formatTaskError(message.error);
    }
  }

  if (!hasFinalResult) {
    throw new Error(`Task stream for tool "${toolName}" ended without a final result`);
  }

  return finalResult;
}

export function withTaskAwareMcpTools<TTools extends ToolSetLike>({
  tools,
  taskClient,
  toolNames = ['run_workflow'],
  fallbackToOriginal = true,
  onTaskEvent,
  onDebug,
}: TaskAwareMcpToolsOptions<TTools>): TTools {
  const wrappedTools: ToolSetLike = { ...tools };

  for (const toolName of toolNames) {
    const sourceTool = tools[toolName];
    if (!sourceTool || typeof sourceTool.execute !== 'function') {
      continue;
    }

    const originalExecute = sourceTool.execute.bind(sourceTool);

    wrappedTools[toolName] = {
      ...sourceTool,
      execute: async (input: unknown, options: ToolExecutionOptions): Promise<unknown> => {
        if (!options?.toolCallId) {
          return originalExecute(input, options);
        }

        try {
          return await runTaskTool({
            taskClient,
            toolName,
            input,
            options,
            onTaskEvent,
          });
        } catch (error) {
          if (!fallbackToOriginal) {
            throw error;
          }

          onDebug?.(
            `[task-aware-mcp] Falling back to default execute() for "${toolName}": ${String(error)}`,
          );
          return originalExecute(input, options);
        }
      },
    };
  }

  return wrappedTools as TTools;
}
