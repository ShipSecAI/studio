/**
 * Shared constants for telemetry and data handling across the ShipSec platform.
 */

/**
 * Spill Thresholds
 * 
 * There are two levels of spilling to handle different payload size limits:
 * 
 * 1. KAFKA_SPILL_THRESHOLD (100KB): For Kafka message size limits
 *    - Node I/O data exceeding this is spilled to object storage before sending via Kafka
 *    - Keeps Kafka messages small and prevents broker issues
 * 
 * 2. TEMPORAL_SPILL_THRESHOLD (2MB): For Temporal workflow history limits
 *    - Activity outputs exceeding this are spilled in the activity itself
 *    - Prevents Temporal gRPC payload size errors
 */
export const KAFKA_SPILL_THRESHOLD_BYTES = 100 * 1024; // 100KB
export const TEMPORAL_SPILL_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Maximum Kafka message size (with safety margin)
 */
export const MAX_KAFKA_MESSAGE_BYTES = 900 * 1024; // 900KB

/**
 * Log chunking threshold for Kafka/Loki
 */
export const LOG_CHUNK_SIZE_CHARS = 100_000; // 100k characters

/**
 * Spilled data marker format.
 * 
 * When data is spilled to object storage, this marker structure is used
 * to indicate that the actual data should be fetched from storage.
 * 
 * Fields:
 * - __spilled__: Always true, indicates this is a spill marker
 * - storageRef: UUID of the file in object storage
 * - originalSize: Size in bytes of the original data
 */
export interface SpilledDataMarker {
  __spilled__: true;
  storageRef: string;
  originalSize: number;
  [key: string]: unknown; // Allow assignment to Record<string, unknown>
}

/**
 * Type guard to check if data is a spilled data marker
 */
export function isSpilledDataMarker(data: unknown): data is SpilledDataMarker {
  return (
    data !== null &&
    typeof data === 'object' &&
    (data as Record<string, unknown>)['__spilled__'] === true &&
    typeof (data as Record<string, unknown>)['storageRef'] === 'string'
  );
}

/**
 * Create a spilled data marker
 */
export function createSpilledMarker(storageRef: string, originalSize: number): SpilledDataMarker {
  return {
    __spilled__: true,
    storageRef,
    originalSize,
  };
}
