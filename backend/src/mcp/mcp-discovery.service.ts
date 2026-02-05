import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import { SecretsEncryptionService } from '../secrets/secrets.encryption';
import { McpGroupsRepository } from '../mcp-groups/mcp-groups.repository';
import type { McpServerRecord } from '../database/schema';
import type { McpToolResponse } from '../mcp-servers/dto/mcp-servers.dto';

/**
 * Result of MCP discovery on a single server
 */
export interface McpToolDiscoveryResult {
  serverId: string;
  serverName: string;
  toolCount: number;
  success: boolean;
  error?: string;
}

/**
 * Result of MCP discovery on a group
 */
export interface GroupDiscoveryResult {
  groupId: string;
  totalServers: number;
  successCount: number;
  failureCount: number;
  results: McpToolDiscoveryResult[];
}

/**
 * Raw MCP tool from protocol
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Service for discovering MCP tools from servers.
 * Handles both HTTP and stdio transport types.
 */
@Injectable()
export class McpDiscoveryService {
  private readonly logger = new Logger(McpDiscoveryService.name);
  private readonly DISCOVERY_TIMEOUT_MS = 30_000;
  private readonly DOCKER_IMAGE = 'shipsec/mcp-stdio-proxy:latest';

  constructor(
    private readonly mcpServersRepository: McpServersRepository,
    private readonly encryption: SecretsEncryptionService,
    private readonly mcpGroupsRepository: McpGroupsRepository,
  ) {}

  /**
   * Discover tools for a single MCP server
   */
  async discoverServer(serverId: string, userId: string): Promise<McpToolResponse[]> {
    this.logger.log(`Starting discovery for server ${serverId}`);

    // Fetch server configuration
    const server = await this.mcpServersRepository.findById(serverId);

    if (server.transportType === 'stdio') {
      return this.discoverStdioServer(server, userId);
    }

    // For HTTP, use existing discovery methods
    return this.discoverHttpServer(server);
  }

  /**
   * Discover tools for all servers in a group
   */
  async discoverGroup(groupId: string, userId: string): Promise<GroupDiscoveryResult> {
    this.logger.log(`Starting group discovery for group ${groupId}`);

    // Fetch all servers in the group
    const servers = await this.mcpGroupsRepository.findServersByGroup(groupId);

    if (servers.length === 0) {
      return {
        groupId,
        totalServers: 0,
        successCount: 0,
        failureCount: 0,
        results: [],
      };
    }

    const results: McpToolDiscoveryResult[] = [];

    // Discover tools for each server in parallel
    const discoveryPromises = servers.map(async (server) => {
      try {
        const tools = await this.discoverServer(server.id, userId);
        return {
          serverId: server.id,
          serverName: server.name,
          toolCount: tools.length,
          success: true,
        };
      } catch (error) {
        this.logger.error(`Discovery failed for server ${server.id}:`, error);
        return {
          serverId: server.id,
          serverName: server.name,
          toolCount: 0,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const discoveryResults = await Promise.all(discoveryPromises);
    results.push(...discoveryResults);

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    this.logger.log(
      `Group discovery complete: ${successCount}/${results.length} servers succeeded`,
    );

    return {
      groupId,
      totalServers: results.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Discover tools from an HTTP MCP server
   */
  private async discoverHttpServer(server: McpServerRecord): Promise<McpToolResponse[]> {
    // Decrypt headers
    let headers: Record<string, string> | null = null;
    if (server.headers) {
      const decryptedJson = await this.encryption.decrypt(server.headers);
      headers = JSON.parse(decryptedJson) as Record<string, string>;
    }

    if (!server.endpoint) {
      throw new Error(`Server ${server.id} has no endpoint configured`);
    }

    // Perform health check and tool discovery
    const tools = await this.performMcpDiscovery(server.endpoint, headers);

    // Upsert tools to database
    const toolRecords = tools.map((tool) => ({
      toolName: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null,
    }));

    await this.mcpServersRepository.upsertTools(server.id, toolRecords);

    // Return as response DTOs
    return toolRecords.map((tool) => ({
      id: `${server.id}-${tool.toolName}`,
      toolName: tool.toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      serverId: server.id,
      serverName: server.name,
      enabled: true,
      discoveredAt: new Date().toISOString(),
    }));
  }

  /**
   * Discover tools from a stdio MCP server by spawning a temporary Docker container
   */
  private async discoverStdioServer(
    server: McpServerRecord,
    _userId: string,
  ): Promise<McpToolResponse[]> {
    let containerId: string | null = null;

    try {
      // Spawn container for stdio server
      const { endpoint, containerId: spawnedContainerId } =
        await this.spawnDiscoveryContainer(server);
      containerId = spawnedContainerId;

      // Perform MCP discovery via the proxy endpoint
      const tools = await this.performMcpDiscovery(endpoint, null);

      // Upsert tools to database
      const toolRecords = tools.map((tool) => ({
        toolName: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? null,
      }));

      await this.mcpServersRepository.upsertTools(server.id, toolRecords);

      // Return as response DTOs
      return toolRecords.map((tool) => ({
        id: `${server.id}-${tool.toolName}`,
        toolName: tool.toolName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverId: server.id,
        serverName: server.name,
        enabled: true,
        discoveredAt: new Date().toISOString(),
      }));
    } finally {
      // Always clean up the container
      if (containerId) {
        try {
          await this.cleanupContainer(containerId);
        } catch (error) {
          this.logger.warn(`Failed to cleanup container ${containerId}:`, error);
        }
      }
    }
  }

  /**
   * Spawn a temporary Docker container for stdio MCP server discovery
   * Uses the shipsec/mcp-stdio-proxy:latest image to proxy stdio to HTTP
   */
  async spawnDiscoveryContainer(server: McpServerRecord): Promise<{
    endpoint: string;
    containerId: string;
  }> {
    const containerName = `mcp-discovery-${server.id}-${Date.now()}`;
    const port = 3000 + Math.floor(Math.random() * 1000);

    if (!server.command) {
      throw new Error(`Server ${server.id} has no command configured`);
    }

    // Build Docker command
    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      '-p',
      `${port}:8080`,
      '-e',
      `MCP_COMMAND=${server.command}`,
      '-e',
      'PORT=8080',
      '-e',
      'MCP_NAMED_SERVERS={}',
    ];

    // Add args as environment variable
    if (server.args && server.args.length > 0) {
      dockerArgs.push('-e', `MCP_ARGS=${JSON.stringify(server.args)}`);
    }

    dockerArgs.push(this.DOCKER_IMAGE);

    this.logger.debug(`Spawning discovery container: docker ${dockerArgs.join(' ')}`);

    return new Promise((resolve, reject) => {
      const dockerProcess = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      dockerProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      dockerProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for container to be fully ready (HTTP server + STDIO client)
      const waitForReady = async () => {
        const healthUrl = `http://localhost:${port}/health`;
        const maxAttempts = 60;
        const pollInterval = 1000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const response = await fetch(healthUrl, { method: 'GET' });
            if (response.ok) {
              const data = (await response.json()) as {
                status?: string;
                servers?: { ready: boolean }[];
              };
              if (data.status === 'ok') {
                const servers = data.servers ?? [];
                const allReady = servers.every((s) => s.ready);
                if (servers.length > 0 && allReady) {
                  this.logger.log(
                    `Discovery container ${containerName} ready after ${attempt + 1}s`,
                  );
                  return;
                }
                if (attempt % 10 === 0) {
                  this.logger.debug(
                    `Container HTTP ready, waiting for MCP server... (${servers.filter((s) => s.ready).length}/${servers.length} ready)`,
                  );
                }
              }
            }
          } catch {
            // Not ready yet, continue polling
          }
          await new Promise((res) => setTimeout(res, pollInterval));
        }
        throw new Error('Container failed to become ready after 60 seconds');
      };

      // Start waiting for readiness
      waitForReady()
        .then(() => {
          const endpoint = `http://localhost:${port}/mcp`;
          this.logger.log(`Discovery container ${containerName} ready at ${endpoint}`);
          resolve({ endpoint, containerId: containerName });
        })
        .catch((error) => {
          reject(new Error(`Failed to start discovery container: ${error.message}`));
        });

      dockerProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn Docker: ${error.message}`));
      });

      dockerProcess.on('exit', (code, _signal) => {
        if (code !== 0 && code !== null) {
          this.logger.warn(`Docker process exited with code ${code}: ${stderr || stdout}`);
        }
      });
    });
  }

  /**
   * Perform MCP protocol discovery by calling tools/list
   */
  async performMcpDiscovery(
    endpoint: string,
    headers?: Record<string, string> | null,
  ): Promise<McpTool[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.DISCOVERY_TIMEOUT_MS);

    try {
      // MCP tools/list request
      const toolsListRequest = {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/list',
        params: {},
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(headers ?? {}),
        },
        body: JSON.stringify(toolsListRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Unexpected content type: ${contentType}`);
      }

      const data = (await response.json()) as {
        error?: { message?: string };
        result?: {
          tools?: McpTool[];
        };
      };

      if (data.error) {
        throw new Error(data.error.message || 'tools/list failed');
      }

      return data.result?.tools ?? [];
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(
            `Discovery timeout (${this.DISCOVERY_TIMEOUT_MS}ms) - server did not respond`,
          );
        }

        if (error.message.includes('ECONNREFUSED')) {
          throw new Error('Connection refused - server may be down or unreachable');
        }

        if (error.message.includes('ENOTFOUND')) {
          throw new Error('DNS lookup failed - check the server URL');
        }

        throw error;
      }

      throw new Error('Unknown error during MCP discovery');
    }
  }

  /**
   * Stop and remove a Docker container
   */
  async cleanupContainer(containerId: string): Promise<void> {
    this.logger.debug(`Cleaning up container ${containerId}`);

    return new Promise<void>((resolve) => {
      const dockerProcess = spawn('docker', ['rm', '-f', containerId], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      dockerProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      dockerProcess.on('close', (code) => {
        if (code === 0) {
          this.logger.debug(`Container ${containerId} cleaned up successfully`);
          resolve();
        } else {
          // Container might not exist, which is fine
          if (stderr.includes('No such container')) {
            this.logger.debug(`Container ${containerId} was already removed`);
            resolve();
          } else {
            this.logger.warn(`Failed to cleanup container ${containerId}: ${stderr}`);
            resolve(); // Don't fail if cleanup fails
          }
        }
      });

      dockerProcess.on('error', (error) => {
        this.logger.warn(`Error during container cleanup: ${error.message}`);
        resolve(); // Don't fail if cleanup fails
      });
    });
  }
}
