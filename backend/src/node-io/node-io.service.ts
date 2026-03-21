import { Injectable, Logger } from '@nestjs/common';
import { NodeIORepository } from './node-io.repository';
import { StorageService } from '../storage/storage.service';
import type { NodeIORecord } from '../database/schema';

export interface NodeIOSummary {
  nodeRef: string;
  componentId: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  inputsSize: number;
  outputsSize: number;
  inputsSpilled: boolean;
  outputsSpilled: boolean;
  errorMessage: string | null;
}

export interface NodeIODetail {
  nodeRef: string;
  componentId: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  inputs: any;
  outputs: any;
  inputsSize: number;
  outputsSize: number;
  inputsSpilled: boolean;
  outputsSpilled: boolean;
  inputsTruncated: boolean;
  outputsTruncated: boolean;
  errorMessage: string | null;
}

@Injectable()
export class NodeIOService {
  private readonly logger = new Logger(NodeIOService.name);

  constructor(
    private readonly repository: NodeIORepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * Get summaries of all node I/O for a run (without full data)
   */
  async listSummaries(runId: string, organizationId?: string | null): Promise<NodeIOSummary[]> {
    const records = await this.repository.listByRunId(runId, organizationId);
    return records.map((r) => this.toSummary(r));
  }

  /**
   * Get full I/O details for a specific node
   */
  async getNodeIO(runId: string, nodeRef: string, full = false): Promise<NodeIODetail | null> {
    const record = await this.repository.findByRunAndNode(runId, nodeRef);
    if (!record) {
      return null;
    }
    return this.toDetail(record, full);
  }

  /**
   * Get all I/O details for a run
   */
  async listDetails(runId: string, organizationId?: string | null): Promise<NodeIODetail[]> {
    const records = await this.repository.listByRunId(runId, organizationId);
    return Promise.all(records.map((r) => this.toDetail(r, false)));
  }

  private toSummary(record: NodeIORecord): NodeIOSummary {
    return {
      nodeRef: record.nodeRef,
      componentId: record.componentId,
      status: record.status as 'running' | 'completed' | 'failed' | 'skipped',
      startedAt: record.startedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      durationMs: record.durationMs,
      inputsSize: record.inputsSize,
      outputsSize: record.outputsSize,
      inputsSpilled: record.inputsSpilled,
      outputsSpilled: record.outputsSpilled,
      errorMessage: record.errorMessage,
    };
  }

  async toDetail(record: NodeIORecord, full = false): Promise<NodeIODetail> {
    let inputs: any = record.inputs ?? null;
    let outputs: any = record.outputs ?? null;

    // Helper to detect if a payload is a spill marker (handles both new and legacy formats)
    const isSpillMarker = (
      data: unknown,
    ): data is { storageRef: string; originalSize?: number } => {
      if (!data || typeof data !== 'object') return false;
      const d = data as Record<string, unknown>;
      // New format: __spilled__ === true
      // Legacy format: __shipsec_spilled__ === true
      const hasSpillFlag = d['__spilled__'] === true || d['__shipsec_spilled__'] === true;
      return hasSpillFlag && typeof d['storageRef'] === 'string';
    };

    let inputsSpilled = record.inputsSpilled;
    let inputsStorageRef = record.inputsStorageRef;
    let inputsSize = record.inputsSize;

    if (!inputsSpilled && isSpillMarker(inputs)) {
      inputsSpilled = true;
      inputsStorageRef = inputs.storageRef;
      inputsSize = inputs.originalSize ?? 0;
    }

    // Track nested spill markers (e.g. { input1: { __spilled__: true, storageRef: ... } })
    const nestedInputSpills = new Map<
      string,
      { storageRef: string; handle?: string; originalSize?: number }
    >();
    if (!inputsSpilled && inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
      for (const [key, value] of Object.entries(inputs)) {
        if (isSpillMarker(value)) {
          const v = value as Record<string, unknown>;
          nestedInputSpills.set(key, {
            storageRef: v.storageRef as string,
            handle: typeof v.__spilled_handle__ === 'string' ? v.__spilled_handle__ : undefined,
            originalSize: typeof v.originalSize === 'number' ? v.originalSize : undefined,
          });
        }
      }
    }

    let outputsSpilled = record.outputsSpilled;
    let outputsStorageRef = record.outputsStorageRef;
    let outputsSize = record.outputsSize;

    if (!outputsSpilled && isSpillMarker(outputs)) {
      outputsSpilled = true;
      outputsStorageRef = outputs.storageRef;
      outputsSize = outputs.originalSize ?? 0;
    }

    // Track nested spill markers in outputs too
    const nestedOutputSpills = new Map<
      string,
      { storageRef: string; handle?: string; originalSize?: number }
    >();
    if (!outputsSpilled && outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
      for (const [key, value] of Object.entries(outputs)) {
        if (isSpillMarker(value)) {
          const v = value as Record<string, unknown>;
          nestedOutputSpills.set(key, {
            storageRef: v.storageRef as string,
            handle: typeof v.__spilled_handle__ === 'string' ? v.__spilled_handle__ : undefined,
            originalSize: typeof v.originalSize === 'number' ? v.originalSize : undefined,
          });
        }
      }
    }

    let inputsTruncated = false;
    if (inputsSpilled && inputsStorageRef) {
      if (full) {
        try {
          const buffer = await this.storage.downloadFile(inputsStorageRef);
          inputs = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          this.logger.error(`Failed to fetch spilled inputs from ${inputsStorageRef}`, err);
          inputs = { error: 'Failed to fetch full data' };
        }
      } else {
        // Fetch preview
        try {
          const buffer = await this.storage.downloadFilePreview(inputsStorageRef, 2048);
          inputs = buffer.toString('utf8').slice(0, 1000) + '\n... (truncated)';
          inputsTruncated = true;
        } catch (err) {
          this.logger.warn(`Failed to fetch preview for inputs from ${inputsStorageRef}`, err);
          inputs = '(Data too large to display, click View Full to load)';
          inputsTruncated = true;
        }
      }
    } else if (nestedInputSpills.size > 0) {
      // Resolve nested spill markers individually
      inputsSpilled = true;
      for (const [key, spill] of nestedInputSpills) {
        if (full) {
          try {
            const buffer = await this.storage.downloadFile(spill.storageRef);
            const fullData = JSON.parse(buffer.toString('utf8'));
            // Extract the handle sub-key if specified
            if (
              spill.handle &&
              spill.handle !== '__self__' &&
              fullData &&
              typeof fullData === 'object'
            ) {
              inputs[key] = fullData[spill.handle] ?? fullData;
            } else {
              inputs[key] = fullData;
            }
          } catch (err) {
            this.logger.error(
              `Failed to fetch spilled input '${key}' from ${spill.storageRef}`,
              err,
            );
            inputs[key] = { error: 'Failed to fetch full data' };
          }
        } else {
          try {
            const buffer = await this.storage.downloadFilePreview(spill.storageRef, 2048);
            inputs[key] = buffer.toString('utf8').slice(0, 1000) + '\n... (truncated)';
            inputsTruncated = true;
          } catch (err) {
            this.logger.warn(
              `Failed to fetch preview for input '${key}' from ${spill.storageRef}`,
              err,
            );
            inputs[key] = '(Data too large to display, click View Full to load)';
            inputsTruncated = true;
          }
        }
      }
    }

    let outputsTruncated = false;
    if (outputsSpilled && outputsStorageRef) {
      if (full) {
        try {
          const buffer = await this.storage.downloadFile(outputsStorageRef);
          outputs = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          this.logger.error(`Failed to fetch spilled outputs from ${outputsStorageRef}`, err);
          outputs = { error: 'Failed to fetch full data' };
        }
      } else {
        try {
          const buffer = await this.storage.downloadFilePreview(outputsStorageRef, 2048);
          outputs = buffer.toString('utf8').slice(0, 1000) + '\n... (truncated)';
          outputsTruncated = true;
        } catch (err) {
          this.logger.warn(`Failed to fetch preview for outputs from ${outputsStorageRef}`, err);
          outputs = '(Data too large to display, click View Full to load)';
          outputsTruncated = true;
        }
      }
    } else if (nestedOutputSpills.size > 0) {
      // Resolve nested spill markers individually
      outputsSpilled = true;
      for (const [key, spill] of nestedOutputSpills) {
        if (full) {
          try {
            const buffer = await this.storage.downloadFile(spill.storageRef);
            const fullData = JSON.parse(buffer.toString('utf8'));
            if (
              spill.handle &&
              spill.handle !== '__self__' &&
              fullData &&
              typeof fullData === 'object'
            ) {
              outputs[key] = fullData[spill.handle] ?? fullData;
            } else {
              outputs[key] = fullData;
            }
          } catch (err) {
            this.logger.error(
              `Failed to fetch spilled output '${key}' from ${spill.storageRef}`,
              err,
            );
            outputs[key] = { error: 'Failed to fetch full data' };
          }
        } else {
          try {
            const buffer = await this.storage.downloadFilePreview(spill.storageRef, 2048);
            outputs[key] = buffer.toString('utf8').slice(0, 1000) + '\n... (truncated)';
            outputsTruncated = true;
          } catch (err) {
            this.logger.warn(
              `Failed to fetch preview for output '${key}' from ${spill.storageRef}`,
              err,
            );
            outputs[key] = '(Data too large to display, click View Full to load)';
            outputsTruncated = true;
          }
        }
      }
    }

    return {
      nodeRef: record.nodeRef,
      componentId: record.componentId,
      status: record.status as 'running' | 'completed' | 'failed' | 'skipped',
      startedAt: record.startedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      durationMs: record.durationMs,
      inputs,
      outputs,
      inputsSize,
      outputsSize,
      inputsSpilled,
      outputsSpilled,
      inputsTruncated,
      outputsTruncated,
      errorMessage: record.errorMessage,
    };
  }
}
