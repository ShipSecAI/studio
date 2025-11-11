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
   * @param key Secret identifier (typically the secret ID)
   * @param options Optional retrieval options such as a version override
   * @returns Secret value or null if not found
   */
  get(
    key: string,
    options?: { version?: number },
  ): Promise<{ value: string; version: number } | null>;

  /**
   * List all available secret keys
   * @returns Array of secret keys
   */
  list(): Promise<string[]>;
}

export type ArtifactDestination = 'run' | 'library';

export interface ArtifactUploadRequest {
  name: string;
  content: Buffer;
  mimeType: string;
  destinations?: ArtifactDestination[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactUploadResult {
  artifactId: string;
  fileId: string;
  name: string;
  destinations: ArtifactDestination[];
}

export interface ArtifactDownloadResult {
  buffer: Buffer;
  metadata: {
    artifactId: string;
    fileId: string;
    name: string;
    mimeType: string;
    size: number;
    createdAt: Date;
    destinations: ArtifactDestination[];
    componentRef?: string;
  };
}

export interface IArtifactService {
  /**
   * Upload an artifact (file, screenshot, report)
   * @param request Artifact payload + metadata
   * @returns Artifact identifiers (artifactId + fileId)
   */
  upload(request: ArtifactUploadRequest): Promise<ArtifactUploadResult>;

  /**
   * Download an artifact by ID
   */
  download(id: string): Promise<ArtifactDownloadResult>;
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
