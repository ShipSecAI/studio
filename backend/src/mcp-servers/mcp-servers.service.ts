import { Injectable, BadRequestException, Logger } from '@nestjs/common';

import { McpServersEncryptionService } from './mcp-servers.encryption';
import { McpServersRepository, type McpServerUpdateData } from './mcp-servers.repository';
import type { AuthContext } from '../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';
import type {
  CreateMcpServerDto,
  UpdateMcpServerDto,
  McpServerResponse,
  McpToolResponse,
  TransportType,
  HealthStatus,
} from './mcp-servers.dto';
import type { McpServerRecord, McpServerToolRecord } from '../database/schema';

@Injectable()
export class McpServersService {
  private readonly logger = new Logger(McpServersService.name);

  constructor(
    private readonly repository: McpServersRepository,
    private readonly encryption: McpServersEncryptionService,
  ) {}

  private resolveOrganizationId(auth: AuthContext | null): string {
    return auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
  }

  private assertOrganizationId(auth: AuthContext | null): string {
    const organizationId = this.resolveOrganizationId(auth);
    if (!organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return organizationId;
  }

  private mapServerToResponse(
    record: McpServerRecord,
    headerKeys?: string[] | null,
  ): McpServerResponse {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      transportType: record.transportType as TransportType,
      endpoint: record.endpoint,
      command: record.command,
      args: record.args,
      hasHeaders: record.headers !== null,
      headerKeys: headerKeys ?? null,
      enabled: record.enabled,
      healthCheckUrl: record.healthCheckUrl,
      lastHealthCheck: record.lastHealthCheck?.toISOString() ?? null,
      lastHealthStatus: record.lastHealthStatus as HealthStatus | null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      groupId: record.groupId ?? null,
    };
  }

  /**
   * Extract header keys from encrypted headers without exposing values
   */
  private async extractHeaderKeys(
    headers: McpServerRecord['headers'],
  ): Promise<string[] | null> {
    if (!headers) return null;
    try {
      const decrypted = await this.encryption.decryptHeaders({
        ciphertext: headers.ciphertext,
        iv: headers.iv,
        authTag: headers.authTag,
        keyId: headers.keyId,
      });
      return Object.keys(decrypted);
    } catch (error) {
      this.logger.warn('Failed to extract header keys', error);
      return null;
    }
  }

  private mapToolToResponse(
    record: McpServerToolRecord & { serverName?: string },
    serverName?: string,
  ): McpToolResponse {
    return {
      id: record.id,
      toolName: record.toolName,
      description: record.description,
      inputSchema: record.inputSchema,
      serverId: record.serverId,
      serverName: record.serverName ?? serverName ?? 'Unknown',
      enabled: record.enabled,
      discoveredAt: record.discoveredAt.toISOString(),
    };
  }

  async listServers(auth: AuthContext | null): Promise<McpServerResponse[]> {
    const organizationId = this.assertOrganizationId(auth);
    const servers = await this.repository.list({ organizationId });
    return servers.map((s) => this.mapServerToResponse(s));
  }

  async listEnabledServers(auth: AuthContext | null): Promise<McpServerResponse[]> {
    const organizationId = this.assertOrganizationId(auth);
    const servers = await this.repository.listEnabled({ organizationId });
    return servers.map((s) => this.mapServerToResponse(s));
  }

  async getServer(auth: AuthContext | null, id: string): Promise<McpServerResponse> {
    const organizationId = this.assertOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });
    // Extract header keys for single server fetch (used in edit UI)
    const headerKeys = await this.extractHeaderKeys(server.headers);
    return this.mapServerToResponse(server, headerKeys);
  }

  async createServer(
    auth: AuthContext | null,
    input: CreateMcpServerDto,
  ): Promise<McpServerResponse> {
    const organizationId = this.assertOrganizationId(auth);

    // Validate transport-specific requirements
    this.validateTransportConfig(input);

    // Encrypt headers if provided
    let encryptedHeaders: {
      ciphertext: string;
      iv: string;
      authTag: string;
      keyId: string;
    } | null = null;

    if (input.headers && Object.keys(input.headers).length > 0) {
      const material = await this.encryption.encryptHeaders(input.headers);
      encryptedHeaders = {
        ciphertext: material.ciphertext,
        iv: material.iv,
        authTag: material.authTag,
        keyId: material.keyId,
      };
    }

    const server = await this.repository.create({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      transportType: input.transportType,
      endpoint: input.endpoint || null,
      command: input.command || null,
      args: input.args || null,
      headers: encryptedHeaders,
      healthCheckUrl: input.healthCheckUrl || null,
      enabled: input.enabled ?? true,
      organizationId,
      createdBy: auth?.userId || null,
    });

    // Return header keys from input (we know the keys since we just created with them)
    const headerKeys = input.headers ? Object.keys(input.headers) : null;
    return this.mapServerToResponse(server, headerKeys);
  }

  async updateServer(
    auth: AuthContext | null,
    id: string,
    input: UpdateMcpServerDto,
  ): Promise<McpServerResponse> {
    const organizationId = this.assertOrganizationId(auth);

    // Get current server to validate transport changes
    const current = await this.repository.findById(id, { organizationId });

    // If transport type is changing, validate the new config
    const effectiveTransportType = input.transportType ?? current.transportType;
    const effectiveEndpoint = input.endpoint !== undefined ? input.endpoint : current.endpoint;
    const effectiveCommand = input.command !== undefined ? input.command : current.command;

    if (input.transportType !== undefined || input.endpoint !== undefined || input.command !== undefined) {
      this.validateTransportConfig({
        transportType: effectiveTransportType as TransportType,
        endpoint: effectiveEndpoint ?? undefined,
        command: effectiveCommand ?? undefined,
      });
    }

    const updates: McpServerUpdateData = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException('Server name cannot be empty');
      }
      updates.name = trimmed;
    }

    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }

    if (input.transportType !== undefined) {
      updates.transportType = input.transportType;
    }

    if (input.endpoint !== undefined) {
      updates.endpoint = input.endpoint;
    }

    if (input.command !== undefined) {
      updates.command = input.command;
    }

    if (input.args !== undefined) {
      updates.args = input.args;
    }

    if (input.headers !== undefined) {
      if (input.headers === null) {
        updates.headers = null;
      } else if (Object.keys(input.headers).length > 0) {
        const material = await this.encryption.encryptHeaders(input.headers);
        updates.headers = {
          ciphertext: material.ciphertext,
          iv: material.iv,
          authTag: material.authTag,
          keyId: material.keyId,
        };
      }
    }

    if (input.healthCheckUrl !== undefined) {
      updates.healthCheckUrl = input.healthCheckUrl;
    }

    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    if (Object.keys(updates).length === 0) {
      const headerKeys = await this.extractHeaderKeys(current.headers);
      return this.mapServerToResponse(current, headerKeys);
    }

    const server = await this.repository.update(id, updates, { organizationId });

    // Determine header keys for response
    let headerKeys: string[] | null = null;
    if (input.headers !== undefined) {
      // Headers were explicitly set in this update
      headerKeys = input.headers ? Object.keys(input.headers) : null;
    } else {
      // Headers unchanged, extract from existing
      headerKeys = await this.extractHeaderKeys(server.headers);
    }

    return this.mapServerToResponse(server, headerKeys);
  }

  async toggleServer(auth: AuthContext | null, id: string): Promise<McpServerResponse> {
    const organizationId = this.assertOrganizationId(auth);
    const current = await this.repository.findById(id, { organizationId });
    const server = await this.repository.update(
      id,
      { enabled: !current.enabled },
      { organizationId },
    );
    return this.mapServerToResponse(server);
  }

  async deleteServer(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = this.assertOrganizationId(auth);
    await this.repository.delete(id, { organizationId });
  }

  async getServerWithDecryptedHeaders(
    auth: AuthContext | null,
    id: string,
  ): Promise<{ server: McpServerRecord; headers: Record<string, string> | null }> {
    const organizationId = this.assertOrganizationId(auth);
    const server = await this.repository.findById(id, { organizationId });

    let headers: Record<string, string> | null = null;
    if (server.headers) {
      headers = await this.encryption.decryptHeaders({
        ciphertext: server.headers.ciphertext,
        iv: server.headers.iv,
        authTag: server.headers.authTag,
        keyId: server.headers.keyId,
      });
    }

    return { server, headers };
  }

  // Tool management

  async getServerTools(auth: AuthContext | null, serverId: string): Promise<McpToolResponse[]> {
    const organizationId = this.assertOrganizationId(auth);
    const server = await this.repository.findById(serverId, { organizationId });
    const tools = await this.repository.listTools(serverId);
    return tools.map((t) => this.mapToolToResponse(t, server.name));
  }

  async getAllTools(auth: AuthContext | null): Promise<McpToolResponse[]> {
    const organizationId = this.assertOrganizationId(auth);
    const tools = await this.repository.listAllToolsForOrganization({ organizationId });
    return tools.map((t) => this.mapToolToResponse(t));
  }

  async updateServerTools(
    auth: AuthContext | null,
    serverId: string,
    tools: Array<{ toolName: string; description?: string | null; inputSchema?: Record<string, unknown> | null }>,
  ): Promise<McpToolResponse[]> {
    const organizationId = this.assertOrganizationId(auth);
    const server = await this.repository.findById(serverId, { organizationId });
    const updated = await this.repository.upsertTools(serverId, tools);
    return updated.map((t) => this.mapToolToResponse(t, server.name));
  }

  async toggleToolEnabled(
    auth: AuthContext | null,
    serverId: string,
    toolId: string,
  ): Promise<McpToolResponse> {
    const organizationId = this.assertOrganizationId(auth);
    // Verify server belongs to organization
    const server = await this.repository.findById(serverId, { organizationId });
    const tool = await this.repository.toggleToolEnabled(toolId);
    return this.mapToolToResponse(tool, server.name);
  }

  async updateHealthStatus(
    auth: AuthContext | null,
    serverId: string,
    status: 'healthy' | 'unhealthy' | 'unknown',
  ): Promise<void> {
    const organizationId = this.assertOrganizationId(auth);
    await this.repository.updateHealthStatus(serverId, status, { organizationId });
  }

  async getHealthStatuses(
    auth: AuthContext | null,
  ): Promise<Array<{ serverId: string; status: HealthStatus; checkedAt: string | null }>> {
    const organizationId = this.assertOrganizationId(auth);
    const servers = await this.repository.listEnabled({ organizationId });
    return servers.map((s) => ({
      serverId: s.id,
      status: (s.lastHealthStatus as HealthStatus) ?? 'unknown',
      checkedAt: s.lastHealthCheck?.toISOString() ?? null,
    }));
  }

  /**
   * Test connection to an MCP server using actual HTTP health check.
   * For HTTP/SSE transports, sends an MCP initialize request to verify the server responds.
   * Also discovers and stores tools on successful connection.
   */
  async testServerConnection(
    auth: AuthContext | null,
    id: string,
  ): Promise<{ success: boolean; message: string; protocolVersion?: string; responseTimeMs?: number; toolCount?: number }> {
    const organizationId = this.assertOrganizationId(auth);
    const { server, headers } = await this.getServerWithDecryptedHeaders(auth, id);

    // stdio and websocket transports require worker integration for full testing
    if (server.transportType === 'stdio') {
      return {
        success: true,
        message: 'stdio transport requires worker integration for connection testing',
      };
    }

    if (server.transportType === 'websocket') {
      return {
        success: true,
        message: 'WebSocket transport requires worker integration for connection testing',
      };
    }

    // HTTP and SSE transports can be tested directly
    if (!server.endpoint) {
      await this.repository.updateHealthStatus(id, 'unhealthy', { organizationId });
      return {
        success: false,
        message: 'Server has no endpoint configured',
      };
    }

    // Use healthCheckUrl if provided, otherwise default to endpoint
    const healthCheckUrl = server.healthCheckUrl || server.endpoint;

    try {
      const startTime = Date.now();
      const result = await this.performMcpHealthCheck(healthCheckUrl, headers);
      const responseTimeMs = Date.now() - startTime;

      // Update health status in database
      await this.repository.updateHealthStatus(
        id,
        result.success ? 'healthy' : 'unhealthy',
        { organizationId },
      );

      // If connection successful, discover tools
      let toolCount: number | undefined;
      if (result.success) {
        try {
          const tools = await this.discoverMcpTools(server.endpoint, headers);
          if (tools.length > 0) {
            await this.repository.upsertTools(id, tools);
            toolCount = tools.length;
            this.logger.log(`Discovered ${tools.length} tools from MCP server ${server.name}`);
          }
        } catch (toolError) {
          this.logger.warn(`Tool discovery failed for server ${id}:`, toolError);
          // Don't fail the health check if tool discovery fails
        }
      }

      return {
        ...result,
        responseTimeMs,
        toolCount,
      };
    } catch (error) {
      this.logger.error(`Health check failed for server ${id}:`, error);
      await this.repository.updateHealthStatus(id, 'unhealthy', { organizationId });
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Health check failed',
      };
    }
  }

  /**
   * Perform MCP protocol health check by sending an initialize request.
   * Uses the Streamable HTTP transport pattern from the MCP spec.
   */
  private async performMcpHealthCheck(
    endpoint: string,
    headers: Record<string, string> | null,
  ): Promise<{ success: boolean; message: string; protocolVersion?: string }> {
    const TIMEOUT_MS = 10_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // MCP Streamable HTTP protocol: POST with JSON-RPC initialize request
      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'shipsec-studio',
            version: '1.0.0',
          },
        },
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(headers ?? {}),
        },
        body: JSON.stringify(initializeRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const statusText = response.statusText || 'Unknown error';
        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            message: `Authentication failed (HTTP ${response.status}): Check your API key or headers`,
          };
        }
        return {
          success: false,
          message: `HTTP ${response.status}: ${statusText}`,
        };
      }

      // Parse response
      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('application/json')) {
        const data = (await response.json()) as {
          error?: { message?: string };
          result?: { protocolVersion?: string };
        };

        // Check for JSON-RPC error
        if (data.error) {
          return {
            success: false,
            message: data.error.message || 'MCP server returned an error',
          };
        }

        // Success - server responded to initialize
        if (data.result?.protocolVersion) {
          return {
            success: true,
            message: `Connected to MCP server (protocol ${data.result.protocolVersion})`,
            protocolVersion: data.result.protocolVersion,
          };
        }

        // Response but no protocol version - might be a non-MCP endpoint
        return {
          success: true,
          message: 'Server responded successfully',
        };
      }

      // SSE response - server is responding in streaming mode
      if (contentType.includes('text/event-stream')) {
        return {
          success: true,
          message: 'MCP server responding (SSE streaming mode)',
        };
      }

      // Other content types - server responded but may not be MCP
      return {
        success: true,
        message: `Server responded (${contentType || 'unknown content type'})`,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            message: `Connection timeout (${TIMEOUT_MS / 1000}s) - server did not respond`,
          };
        }

        // Network errors
        if (error.message.includes('ECONNREFUSED')) {
          return {
            success: false,
            message: 'Connection refused - server may be down or unreachable',
          };
        }

        if (error.message.includes('ENOTFOUND')) {
          return {
            success: false,
            message: 'DNS lookup failed - check the server URL',
          };
        }

        if (error.message.includes('certificate')) {
          return {
            success: false,
            message: 'SSL/TLS certificate error - check server certificate',
          };
        }

        return {
          success: false,
          message: error.message,
        };
      }

      return {
        success: false,
        message: 'Unknown error during health check',
      };
    }
  }

  /**
   * Discover tools from an MCP server by sending a tools/list request.
   */
  private async discoverMcpTools(
    endpoint: string,
    headers: Record<string, string> | null,
  ): Promise<Array<{ toolName: string; description?: string | null; inputSchema?: Record<string, unknown> | null }>> {
    const TIMEOUT_MS = 10_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // MCP tools/list request
      const toolsListRequest = {
        jsonrpc: '2.0',
        id: 2,
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
          tools?: Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          }>;
        };
      };

      if (data.error) {
        throw new Error(data.error.message || 'tools/list failed');
      }

      const tools = data.result?.tools ?? [];
      return tools.map((tool) => ({
        toolName: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? null,
      }));
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private validateTransportConfig(config: {
    transportType: TransportType;
    endpoint?: string | null;
    command?: string | null;
  }): void {
    const requiresEndpoint = ['http', 'sse', 'websocket'].includes(config.transportType);
    const requiresCommand = config.transportType === 'stdio';

    if (requiresEndpoint && !config.endpoint) {
      throw new BadRequestException(
        `${config.transportType} transport requires an endpoint URL`,
      );
    }

    if (requiresCommand && !config.command) {
      throw new BadRequestException('stdio transport requires a command');
    }
  }
}
