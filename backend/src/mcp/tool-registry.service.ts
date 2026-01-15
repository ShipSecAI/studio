/**
 * Tool Registry Service
 *
 * Redis-backed registry for storing tool metadata and credentials during workflow runs.
 * This bridges the gap between Temporal workflows (where credentials are resolved)
 * and the MCP gateway (where agents call tools).
 *
 * Redis key pattern: mcp:run:{runId}:tools (Hash)
 * TTL: 1 hour (configurable)
 */

import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { SecretsEncryptionService } from '../secrets/secrets.encryption';

export const TOOL_REGISTRY_REDIS = Symbol('TOOL_REGISTRY_REDIS');

/**
 * Types of tools that can be registered
 */
export type RegisteredToolType = 'component' | 'remote-mcp' | 'local-mcp';

/**
 * Status of a registered tool
 */
export type ToolStatus = 'pending' | 'ready' | 'error';

/**
 * JSON Schema for tool input
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: unknown[];
    items?: unknown;
  }>;
  required: string[];
}

/**
 * A tool registered in the registry
 */
export interface RegisteredTool {
  /** Unique ID of the workflow node */
  nodeId: string;

  /** Tool name exposed to the agent */
  toolName: string;

  /** Type of tool */
  type: RegisteredToolType;

  /** Current status */
  status: ToolStatus;

  /** Component ID (for component tools) */
  componentId?: string;

  /** JSON Schema for action inputs */
  inputSchema: ToolInputSchema;

  /** Tool description for the agent */
  description: string;

  /** Encrypted credentials (for component tools) */
  encryptedCredentials?: string;

  /** MCP endpoint URL (for remote/local MCPs) */
  endpoint?: string;

  /** Docker container ID (for local MCPs) */
  containerId?: string;

  /** Error message if status is 'error' */
  errorMessage?: string;

  /** Timestamp when tool was registered */
  registeredAt: string;
}

/**
 * Input for registering a component tool
 */
export interface RegisterComponentToolInput {
  runId: string;
  nodeId: string;
  toolName: string;
  componentId: string;
  description: string;
  inputSchema: ToolInputSchema;
  credentials: Record<string, unknown>;
}

/**
 * Input for registering a remote MCP
 */
export interface RegisterRemoteMcpInput {
  runId: string;
  nodeId: string;
  toolName: string;
  description: string;
  inputSchema: ToolInputSchema;
  endpoint: string;
  authToken?: string;
}

/**
 * Input for registering a local MCP (stdio container)
 */
export interface RegisterLocalMcpInput {
  runId: string;
  nodeId: string;
  toolName: string;
  description: string;
  inputSchema: ToolInputSchema;
  endpoint: string;
  containerId: string;
}

const REGISTRY_TTL_SECONDS = 60 * 60; // 1 hour

@Injectable()
export class ToolRegistryService implements OnModuleDestroy {
  private readonly logger = new Logger(ToolRegistryService.name);

  constructor(
    @Inject(TOOL_REGISTRY_REDIS) private readonly redis: Redis | null,
    private readonly encryption: SecretsEncryptionService,
  ) {}

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  private getRegistryKey(runId: string): string {
    return `mcp:run:${runId}:tools`;
  }

  /**
   * Register a ShipSec component as an agent-callable tool
   */
  async registerComponentTool(input: RegisterComponentToolInput): Promise<void> {
    if (!this.redis) {
      this.logger.warn('Redis not configured, tool registry disabled');
      return;
    }

    const { runId, nodeId, toolName, componentId, description, inputSchema, credentials } = input;

    // Encrypt credentials
    const credentialsJson = JSON.stringify(credentials);
    const encryptionMaterial = await this.encryption.encrypt(credentialsJson);
    const encryptedCredentials = JSON.stringify(encryptionMaterial);

    const tool: RegisteredTool = {
      nodeId,
      toolName,
      type: 'component',
      status: 'ready',
      componentId,
      description,
      inputSchema,
      encryptedCredentials,
      registeredAt: new Date().toISOString(),
    };

    const key = this.getRegistryKey(runId);
    await this.redis.hset(key, nodeId, JSON.stringify(tool));
    await this.redis.expire(key, REGISTRY_TTL_SECONDS);

    this.logger.log(`Registered component tool: ${toolName} (node: ${nodeId}, run: ${runId})`);
  }

  /**
   * Register a remote HTTP MCP server
   */
  async registerRemoteMcp(input: RegisterRemoteMcpInput): Promise<void> {
    if (!this.redis) {
      this.logger.warn('Redis not configured, tool registry disabled');
      return;
    }

    const { runId, nodeId, toolName, description, inputSchema, endpoint, authToken } = input;

    // Encrypt auth token if provided
    let encryptedCredentials: string | undefined;
    if (authToken) {
      const encryptionMaterial = await this.encryption.encrypt(authToken);
      encryptedCredentials = JSON.stringify(encryptionMaterial);
    }

    const tool: RegisteredTool = {
      nodeId,
      toolName,
      type: 'remote-mcp',
      status: 'ready',
      description,
      inputSchema,
      endpoint,
      encryptedCredentials,
      registeredAt: new Date().toISOString(),
    };

    const key = this.getRegistryKey(runId);
    await this.redis.hset(key, nodeId, JSON.stringify(tool));
    await this.redis.expire(key, REGISTRY_TTL_SECONDS);

    this.logger.log(`Registered remote MCP: ${toolName} (node: ${nodeId}, run: ${runId})`);
  }

  /**
   * Register a local stdio MCP running in Docker
   */
  async registerLocalMcp(input: RegisterLocalMcpInput): Promise<void> {
    if (!this.redis) {
      this.logger.warn('Redis not configured, tool registry disabled');
      return;
    }

    const { runId, nodeId, toolName, description, inputSchema, endpoint, containerId } = input;

    const tool: RegisteredTool = {
      nodeId,
      toolName,
      type: 'local-mcp',
      status: 'ready',
      description,
      inputSchema,
      endpoint,
      containerId,
      registeredAt: new Date().toISOString(),
    };

    const key = this.getRegistryKey(runId);
    await this.redis.hset(key, nodeId, JSON.stringify(tool));
    await this.redis.expire(key, REGISTRY_TTL_SECONDS);

    this.logger.log(`Registered local MCP: ${toolName} (node: ${nodeId}, container: ${containerId}, run: ${runId})`);
  }

  /**
   * Get all registered tools for a workflow run
   */
  async getToolsForRun(runId: string): Promise<RegisteredTool[]> {
    if (!this.redis) {
      return [];
    }

    const key = this.getRegistryKey(runId);
    const toolsHash = await this.redis.hgetall(key);

    return Object.values(toolsHash).map(json => JSON.parse(json) as RegisteredTool);
  }

  /**
   * Get a specific tool by node ID
   */
  async getTool(runId: string, nodeId: string): Promise<RegisteredTool | null> {
    if (!this.redis) {
      return null;
    }

    const key = this.getRegistryKey(runId);
    const toolJson = await this.redis.hget(key, nodeId);

    if (!toolJson) {
      return null;
    }

    return JSON.parse(toolJson) as RegisteredTool;
  }

  /**
   * Get a tool by its tool name
   */
  async getToolByName(runId: string, toolName: string): Promise<RegisteredTool | null> {
    const tools = await this.getToolsForRun(runId);
    return tools.find(t => t.toolName === toolName) ?? null;
  }

  /**
   * Decrypt and return credentials for a tool
   */
  async getToolCredentials(runId: string, nodeId: string): Promise<Record<string, unknown> | null> {
    const tool = await this.getTool(runId, nodeId);
    if (!tool?.encryptedCredentials) {
      return null;
    }

    try {
      const encryptionMaterial = JSON.parse(tool.encryptedCredentials);
      const decrypted = await this.encryption.decrypt(encryptionMaterial);
      return JSON.parse(decrypted);
    } catch (error) {
      this.logger.error(`Failed to decrypt credentials for tool ${nodeId}:`, error);
      return null;
    }
  }

  /**
   * Check if all required tools are ready
   */
  async areAllToolsReady(runId: string, requiredNodeIds: string[]): Promise<boolean> {
    if (!this.redis) {
      return true; // If Redis is disabled, assume ready
    }

    const key = this.getRegistryKey(runId);

    for (const nodeId of requiredNodeIds) {
      const toolJson = await this.redis.hget(key, nodeId);
      if (!toolJson) {
        return false;
      }

      const tool = JSON.parse(toolJson) as RegisteredTool;
      if (tool.status !== 'ready') {
        return false;
      }
    }

    return true;
  }

  /**
   * Update tool status (e.g., to 'error')
   */
  async updateToolStatus(
    runId: string,
    nodeId: string,
    status: ToolStatus,
    errorMessage?: string,
  ): Promise<void> {
    if (!this.redis) {
      return;
    }

    const tool = await this.getTool(runId, nodeId);
    if (!tool) {
      return;
    }

    tool.status = status;
    if (errorMessage) {
      tool.errorMessage = errorMessage;
    }

    const key = this.getRegistryKey(runId);
    await this.redis.hset(key, nodeId, JSON.stringify(tool));
  }

  /**
   * Clean up all tools for a run (called when workflow completes)
   * Returns container IDs that need to be stopped
   */
  async cleanupRun(runId: string): Promise<string[]> {
    if (!this.redis) {
      return [];
    }

    const tools = await this.getToolsForRun(runId);
    const containerIds = tools
      .filter(t => t.type === 'local-mcp' && t.containerId)
      .map(t => t.containerId!);

    const key = this.getRegistryKey(runId);
    await this.redis.del(key);

    this.logger.log(`Cleaned up tool registry for run ${runId} (${tools.length} tools, ${containerIds.length} containers)`);

    return containerIds;
  }
}
