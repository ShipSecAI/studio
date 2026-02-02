import type { Entry as HarEntry, Request as HarRequest } from 'har-format';

export type TraceEventType =
  | 'NODE_STARTED'
  | 'NODE_COMPLETED'
  | 'NODE_FAILED'
  | 'NODE_PROGRESS'
  | 'AWAITING_INPUT'
  | 'NODE_SKIPPED'
  | 'HTTP_REQUEST_SENT'
  | 'HTTP_RESPONSE_RECEIVED'
  | 'HTTP_REQUEST_ERROR';

export interface TraceEventBase {
  runId: string;
  nodeRef: string;
  timestamp: string;
}

export interface NodeStartedEvent extends TraceEventBase {
  type: 'NODE_STARTED';
}

export interface NodeCompletedEvent extends TraceEventBase {
  type: 'NODE_COMPLETED';
  outputSummary?: unknown;
}

export interface NodeFailedEvent extends TraceEventBase {
  type: 'NODE_FAILED';
  error: string;
}

export interface NodeProgressEvent extends TraceEventBase {
  type: 'NODE_PROGRESS';
  message: string;
}

export interface AwaitingInputEvent extends TraceEventBase {
  type: 'AWAITING_INPUT';
  data?: {
    requestId?: string;
    inputType?: string;
    title?: string;
    description?: string;
    timeoutAt?: string;
  };
}

export interface NodeSkippedEvent extends TraceEventBase {
  type: 'NODE_SKIPPED';
}

export interface HttpRequestSentEvent extends TraceEventBase {
  type: 'HTTP_REQUEST_SENT';
  data: {
    correlationId: string;
    request: HarRequest;
  };
}

export interface HttpResponseReceivedEvent extends TraceEventBase {
  type: 'HTTP_RESPONSE_RECEIVED';
  data: {
    correlationId: string;
    har: HarEntry;
  };
}

export interface HttpRequestErrorEvent extends TraceEventBase {
  type: 'HTTP_REQUEST_ERROR';
  data: {
    correlationId: string;
    request: HarRequest;
    error: {
      message: string;
      name?: string;
    };
  };
}

export type TraceEvent =
  | NodeStartedEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | NodeProgressEvent
  | AwaitingInputEvent
  | NodeSkippedEvent
  | HttpRequestSentEvent
  | HttpResponseReceivedEvent
  | HttpRequestErrorEvent;
