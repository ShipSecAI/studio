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
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  inputsSize: number;
  outputsSize: number;
  inputsSpilled: boolean;
  outputsSpilled: boolean;
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
    let inputs = record.inputs ?? null;
    let outputs = record.outputs ?? null;

    // Helper to detect if a payload is a spill marker (handles both new and legacy formats)
    const isSpillMarker = (data: unknown): data is { storageRef: string; originalSize?: number } => {
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

    let outputsSpilled = record.outputsSpilled;
    let outputsStorageRef = record.outputsStorageRef;
    let outputsSize = record.outputsSize;

    if (!outputsSpilled && isSpillMarker(outputs)) {
      outputsSpilled = true;
      outputsStorageRef = outputs.storageRef;
      outputsSize = outputs.originalSize ?? 0;
    }

    if (inputsSpilled && inputsStorageRef) {
      if (full) {
        try {
          const buffer = await this.storage.downloadFile(inputsStorageRef);
          inputs = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          this.logger.error(`Failed to fetch spilled inputs from ${inputsStorageRef}`, err);
          inputs = { _error: 'Failed to fetch spilled data', _ref: inputsStorageRef };
        }
      } else {
        // Fetch preview
         try {
          const buffer = await this.storage.downloadFilePreview(inputsStorageRef, 2048);
          const previewStr = buffer.toString('utf8');
          inputs = { 
            _spilled: true,
            _truncated: true,
            size: inputsSize,
            preview: previewStr.slice(0, 500) + '...',
            _ref: inputsStorageRef 
          };
        } catch (err) {
          this.logger.warn(`Failed to fetch preview for inputs from ${inputsStorageRef}`, err);
          inputs = { _spilled: true, size: inputsSize, _ref: inputsStorageRef };
        }
      }
    }

    if (outputsSpilled && outputsStorageRef) {
      if (full) {
        try {
          const buffer = await this.storage.downloadFile(outputsStorageRef);
          outputs = JSON.parse(buffer.toString('utf8'));
        } catch (err) {
          this.logger.error(`Failed to fetch spilled outputs from ${outputsStorageRef}`, err);
          outputs = { _error: 'Failed to fetch spilled data', _ref: outputsStorageRef };
        }
      } else {
         try {
          const buffer = await this.storage.downloadFilePreview(outputsStorageRef, 2048);
          const previewStr = buffer.toString('utf8');
          outputs = { 
            _spilled: true, 
            _truncated: true,
            size: outputsSize, 
            preview: previewStr.slice(0, 500) + '...',
            _ref: outputsStorageRef 
          };
        } catch (err) {
          this.logger.warn(`Failed to fetch preview for outputs from ${outputsStorageRef}`, err);
          outputs = { _spilled: true, size: outputsSize, _ref: outputsStorageRef };
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
      errorMessage: record.errorMessage,
    };
  }
}
