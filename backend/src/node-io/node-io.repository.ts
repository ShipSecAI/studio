import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { nodeIOTable, type NodeIORecord, type NodeIOInsert } from '../database/schema';
import { DRIZZLE_TOKEN } from '../database/database.module';

export interface NodeIOData {
  runId: string;
  nodeRef: string;
  workflowId?: string;
  organizationId?: string | null;
  componentId: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  startedAt?: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  errorMessage?: string;
}

import { 
  KAFKA_SPILL_THRESHOLD_BYTES, 
  createSpilledMarker 
} from '@shipsec/component-sdk';

@Injectable()
export class NodeIORepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Record node execution start (inputs captured)
   */
  async recordStart(data: {
    runId: string;
    nodeRef: string;
    workflowId?: string;
    organizationId?: string | null;
    componentId: string;
    inputs?: Record<string, unknown>;
    inputsSpilled?: boolean;
    inputsStorageRef?: string | null;
    inputsSize?: number;
  }): Promise<void> {
    const inputsJson = data.inputs ? JSON.stringify(data.inputs) : null;
    const computedInputsSize = inputsJson ? Buffer.byteLength(inputsJson, 'utf8') : 0;

    // Favor provided spilled info from worker, fallback to local calculation
    const inputsSize = data.inputsSize ?? computedInputsSize;
    const inputsSpilled = data.inputsSpilled ?? (inputsSize > KAFKA_SPILL_THRESHOLD_BYTES);
    // Use the storage ref provided by worker (UUID), or generate a path-based fallback
    const inputsStorageRef = data.inputsStorageRef ?? null;

    const insert: NodeIOInsert = {
      runId: data.runId,
      nodeRef: data.nodeRef,
      workflowId: data.workflowId ?? null,
      organizationId: data.organizationId ?? null,
      componentId: data.componentId,
      inputs: inputsSpilled 
        ? createSpilledMarker(inputsStorageRef ?? 'unknown', inputsSize) 
        : data.inputs,
      inputsSize,
      inputsSpilled,
      inputsStorageRef,
      startedAt: new Date(),
      status: 'running',
    };

    await this.db.insert(nodeIOTable).values(insert).onConflictDoUpdate({
      target: [nodeIOTable.runId, nodeIOTable.nodeRef],
      set: {
        ...insert,
        // Only update status to 'running' if it's not already in a terminal state
        status: sql`CASE 
          WHEN ${nodeIOTable.status} IN ('completed', 'failed', 'skipped') 
          THEN ${nodeIOTable.status} 
          ELSE ${insert.status} 
        END`,
        updatedAt: new Date(),
      }
    });
  }

  /**
   * Update node execution with outputs (completion)
   */
  async recordCompletion(data: {
    runId: string;
    nodeRef: string;
    componentId?: string;
    outputs: Record<string, unknown>;
    status: 'completed' | 'failed' | 'skipped';
    errorMessage?: string;
    outputsSpilled?: boolean;
    outputsStorageRef?: string | null;
    outputsSize?: number;
  }): Promise<void> {
    const outputsJson = JSON.stringify(data.outputs);
    const computedOutputsSize = Buffer.byteLength(outputsJson, 'utf8');

    // Favor provided spilled info from worker, fallback to local calculation
    const outputsSize = data.outputsSize ?? computedOutputsSize;
    const outputsSpilled = data.outputsSpilled ?? (outputsSize > KAFKA_SPILL_THRESHOLD_BYTES);
    // Use the storage ref provided by worker (UUID), or generate a path-based fallback
    const outputsStorageRef = data.outputsStorageRef ?? null;

    const completedAt = new Date();

    // Get existing record to calculate duration BEFORE upserting
    const existing = await this.findByRunAndNode(data.runId, data.nodeRef);
    const durationMs = existing?.startedAt
      ? completedAt.getTime() - new Date(existing.startedAt).getTime()
      : null;

    const insert: NodeIOInsert = {
      runId: data.runId,
      nodeRef: data.nodeRef,
      componentId: data.componentId || existing?.componentId || 'unknown',
      outputs: outputsSpilled 
        ? createSpilledMarker(outputsStorageRef ?? 'unknown', outputsSize) 
        : data.outputs,
      outputsSize,
      outputsSpilled,
      outputsStorageRef,
      completedAt,
      durationMs,
      status: data.status,
      errorMessage: data.errorMessage ?? null,
    };

    await this.db.insert(nodeIOTable).values(insert).onConflictDoUpdate({
      target: [nodeIOTable.runId, nodeIOTable.nodeRef],
      set: {
        outputs: insert.outputs,
        outputsSize: insert.outputsSize,
        outputsSpilled: insert.outputsSpilled,
        outputsStorageRef: insert.outputsStorageRef,
        completedAt: insert.completedAt,
        durationMs: insert.durationMs,
        status: insert.status,
        errorMessage: insert.errorMessage,
        updatedAt: new Date(),
      }
    });
  }

  /**
   * Get all node I/O records for a run
   */
  async listByRunId(runId: string, organizationId?: string | null): Promise<NodeIORecord[]> {
    const conditions = [eq(nodeIOTable.runId, runId)];
    if (organizationId) {
      conditions.push(eq(nodeIOTable.organizationId, organizationId));
    }

    return this.db
      .select()
      .from(nodeIOTable)
      .where(and(...conditions))
      .orderBy(nodeIOTable.startedAt);
  }

  /**
   * Get I/O for a specific node in a run
   */
  async findByRunAndNode(runId: string, nodeRef: string): Promise<NodeIORecord | null> {
    const [record] = await this.db
      .select()
      .from(nodeIOTable)
      .where(
        and(
          eq(nodeIOTable.runId, runId),
          eq(nodeIOTable.nodeRef, nodeRef),
        ),
      )
      .limit(1);

    return record ?? null;
  }
}
