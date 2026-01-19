export interface AgentReasoningAction {
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
}

export type AgentReasoningObservation = AgentReasoningAction & {
  result?: unknown;
};

export interface AgentStep {
  step?: number;
  thought?: string;
  finishReason?: string;
  actions?: AgentReasoningAction[];
  observations?: AgentReasoningObservation[];
}

export interface AgentToolMetadata {
  toolId?: string;
  title?: string;
  description?: string;
  source?: string;
  endpoint?: string;
}

export interface AgentToolInvocation {
  id?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  timestamp?: string;
  metadata?: AgentToolMetadata;
}

export interface AgentNodeOutput {
  responseText?: string;
  reasoningTrace?: AgentStep[];
  toolInvocations?: AgentToolInvocation[];
  conversationState?: unknown;
  usage?: unknown;
  live?: boolean;
  agentRunId?: string;
  [key: string]: unknown;
}
