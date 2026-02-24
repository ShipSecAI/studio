import type { ToolExecutionOptions } from 'ai';

interface TaskState {
  taskId: string;
  status: string;
  statusMessage?: string;
  pollInterval?: number;
}

type TaskStreamMessage =
  | { type: 'taskCreated'; task: unknown; _meta?: Record<string, unknown> }
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
  returnOnTaskCreated?: boolean;
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

function getModelImmediateResponse(rawMessage: unknown): string | undefined {
  if (!isRecord(rawMessage)) return undefined;

  const directMeta = isRecord(rawMessage._meta) ? rawMessage._meta : undefined;
  const taskMeta =
    isRecord(rawMessage.task) && isRecord(rawMessage.task._meta)
      ? (rawMessage.task._meta as Record<string, unknown>)
      : undefined;

  const fromDirect = directMeta?.['io.modelcontextprotocol/model-immediate-response'];
  if (typeof fromDirect === 'string' && fromDirect.length > 0) return fromDirect;

  const fromTask = taskMeta?.['io.modelcontextprotocol/model-immediate-response'];
  if (typeof fromTask === 'string' && fromTask.length > 0) return fromTask;

  return undefined;
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
  returnOnTaskCreated,
}: {
  taskClient: TaskAwareMcpClient;
  toolName: string;
  input: unknown;
  options: ToolExecutionOptions;
  onTaskEvent?: (event: TaskToolEvent) => void | Promise<void>;
  returnOnTaskCreated?: boolean;
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

      if (returnOnTaskCreated && message.type === 'taskCreated') {
        // Prefer _meta model-immediate-response (spec-correct), fall back to statusMessage
        // (workaround for SDK bug where _meta is dropped from callToolStream taskCreated events)
        const immediate = getModelImmediateResponse(message);
        const responseText =
          immediate ||
          state.statusMessage ||
          `Background task started (taskId: ${state.taskId}, status: ${state.status}). Continue and poll task status for updates.`;
        return {
          content: [{ type: 'text' as const, text: responseText }],
        };
      }
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
  returnOnTaskCreated = false,
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
            returnOnTaskCreated,
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
