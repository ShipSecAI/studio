export type LogStream = 'stdout' | 'stderr' | 'console';

export interface LogMetadata {
  activityId?: string;
  attempt?: number;
  correlationId?: string;
  streamId?: string;
  joinStrategy?: 'all' | 'any' | 'first';
  triggeredBy?: string;
  failure?: {
    at: string;
    reason: {
      message: string;
      name?: string;
    };
  };
}

export interface KafkaLogEntry {
  runId: string;
  nodeRef: string;
  stream: LogStream;
  message: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  timestamp?: string;
  metadata?: LogMetadata;
  organizationId?: string | null;
}
