import type { ExecutionContext, AgentTraceEvent } from '@shipsec/component-sdk';

export type AgentStreamPart =
  | {
      type: 'message-start';
      messageId: string;
      role: 'assistant' | 'user';
      metadata?: Record<string, unknown>;
    }
  | { type: 'text-delta'; textDelta: string }
  | {
      type: 'tool-input-available';
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | { type: 'tool-output-available'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'finish'; finishReason: string; responseText: string }
  | { type: `data-${string}`; data: unknown };

export class AgentStreamRecorder {
  private sequence = 0;
  private activeTextId: string | null = null;

  constructor(
    private readonly context: ExecutionContext,
    private readonly agentRunId: string,
  ) {}

  emitMessageStart(role: 'assistant' | 'user' = 'assistant'): void {
    this.emitPart({
      type: 'message-start',
      messageId: this.agentRunId,
      role,
    });
  }

  emitToolInput(toolCallId: string, toolName: string, input: Record<string, unknown>): void {
    this.emitPart({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input,
    });
  }

  emitToolOutput(toolCallId: string, toolName: string, output: unknown): void {
    this.emitPart({
      type: 'tool-output-available',
      toolCallId,
      toolName,
      output,
    });
  }

  emitToolError(toolCallId: string, toolName: string, error: string): void {
    this.emitPart({
      type: 'data-tool-error',
      data: { toolCallId, toolName, error },
    });
  }

  private ensureTextStream(): string {
    if (this.activeTextId) {
      return this.activeTextId;
    }
    const textId = `${this.agentRunId}:text`;
    this.emitPart({
      type: 'data-text-start',
      data: { id: textId },
    });
    this.activeTextId = textId;
    return textId;
  }

  emitTextDelta(textDelta: string): void {
    if (!textDelta.trim()) {
      return;
    }
    this.ensureTextStream();
    this.emitPart({
      type: 'text-delta',
      textDelta,
    });
  }

  emitFinish(finishReason: string, responseText: string): void {
    if (this.activeTextId) {
      this.emitPart({
        type: 'data-text-end',
        data: { id: this.activeTextId },
      });
      this.activeTextId = null;
    }
    this.emitPart({
      type: 'finish',
      finishReason,
      responseText,
    });
  }

  private emitPart(part: AgentStreamPart): void {
    const timestamp = new Date().toISOString();
    const sequence = ++this.sequence;
    const envelope: AgentTraceEvent = {
      agentRunId: this.agentRunId,
      workflowRunId: this.context.runId,
      nodeRef: this.context.componentRef,
      sequence,
      timestamp,
      part,
    };

    if (this.context.agentTracePublisher) {
      void this.context.agentTracePublisher.publish(envelope);
      return;
    }

    this.context.emitProgress({
      level: 'info',
      message: `[AgentTraceFallback] ${part.type}`,
      data: envelope,
    });
  }
}
