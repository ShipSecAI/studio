/**
 * Types for the chat agent workflow and activities.
 * MUST NOT import anything that executes code or external libraries.
 */

/** Minimal UIMessage representation for workflow state */
export interface ChatUIMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  parts: ChatMessagePart[];
}

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-invocation'; toolInvocation: Record<string, unknown> }
  | { type: 'reasoning'; reasoning: string; details?: unknown[] }
  | Record<string, unknown>;

/** Input for the runChatAgentStep activity */
export interface ChatAgentStepInput {
  sessionId: string;
  turnId: string;
  runId: string;
  generationId: number;
  organizationId?: string;
  systemPrompt: string;
  messages: ChatUIMessage[];
  maxSteps: number;
  queuedAt?: string;
}

/** Output from the runChatAgentStep activity */
export interface ChatAgentStepOutput {
  turnId: string;
  runId: string;
  generationId: number;
  assistantMessages: ChatUIMessage[];
  interrupted?: boolean;
}

/** Input for saveChatMessages activity */
export interface SaveChatMessagesInput {
  sessionId: string;
  messages: ChatUIMessage[];
}

/** Input for loadChatMessages activity */
export interface LoadChatMessagesInput {
  sessionId: string;
}
