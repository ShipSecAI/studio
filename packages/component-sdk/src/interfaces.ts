/**
 * Service interfaces for component execution context
 * These define contracts that must be implemented by adapters
 */

export interface IFileStorageService {
  /**
   * Download a file by its unique identifier
   * @param fileId UUID of the file to download
   * @returns File buffer and metadata
   */
  downloadFile(fileId: string): Promise<{
    buffer: Buffer;
    metadata: {
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
    };
  }>;

  /**
   * Get file metadata without downloading content
   * @param fileId UUID of the file
   * @returns File metadata
   */
  getFileMetadata(fileId: string): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    uploadedAt: Date;
  }>;
}

export interface ISecretsService {
  /**
   * Retrieve a secret value by key
   * @param key Secret identifier
   * @returns Secret value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * List all available secret keys
   * @returns Array of secret keys
   */
  list(): Promise<string[]>;
}

export interface IArtifactService {
  /**
   * Upload an artifact (file, screenshot, report)
   * @param name Artifact name
   * @param content File buffer
   * @param mimeType Content type
   * @returns Artifact ID/URL
   */
  upload(name: string, content: Buffer, mimeType: string): Promise<string>;

  /**
   * Download an artifact by ID
   * @param id Artifact identifier
   * @returns Artifact buffer
   */
  download(id: string): Promise<Buffer>;
}

export interface ITraceService {
  /**
   * Record a trace event
   * @param event Trace event data
   */
  record(event: TraceEvent): void;
}

export type TraceEventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ExecutionFailureMetadata {
  at: string;
  reason: {
    message: string;
    name?: string;
  };
}

export interface ExecutionContextMetadata {
  runId: string;
  componentRef: string;
  activityId?: string;
  attempt?: number;
  correlationId?: string;
  streamId?: string;
  joinStrategy?: 'all' | 'any' | 'first';
  triggeredBy?: string;
  failure?: ExecutionFailureMetadata;
}

export interface TraceEvent {
  type: 'NODE_STARTED' | 'NODE_COMPLETED' | 'NODE_FAILED' | 'NODE_PROGRESS';
  runId: string;
  nodeRef: string;
  timestamp: string;
  level: TraceEventLevel;
  message?: string;
  error?: string;
  outputSummary?: unknown;
  data?: unknown;
  context?: ExecutionContextMetadata;
}
