import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MinLength, ValidateIf } from 'class-validator';

export type TransportType = 'http' | 'stdio' | 'sse' | 'websocket';
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export class CreateMcpServerDto {
  @ApiProperty({ description: 'Human-readable unique name for the MCP server' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ description: 'Optional description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Transport type for connecting to the MCP server',
    enum: ['http', 'stdio', 'sse', 'websocket'],
  })
  @IsEnum(['http', 'stdio', 'sse', 'websocket'])
  transportType!: TransportType;

  @ApiPropertyOptional({ description: 'URL endpoint for HTTP/SSE/WebSocket transports' })
  @ValidateIf((o) => ['http', 'sse', 'websocket'].includes(o.transportType))
  @IsUrl({ require_tld: false })
  endpoint?: string;

  @ApiPropertyOptional({ description: 'Command to run for stdio transport' })
  @ValidateIf((o) => o.transportType === 'stdio')
  @IsString()
  @MinLength(1)
  command?: string;

  @ApiPropertyOptional({ description: 'Arguments for stdio command', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[];

  @ApiPropertyOptional({
    description: 'HTTP headers for authentication (will be encrypted)',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  headers?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Custom health check URL (optional)' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  healthCheckUrl?: string;

  @ApiPropertyOptional({ description: 'Whether the server is enabled', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateMcpServerDto {
  @ApiPropertyOptional({ description: 'Human-readable unique name for the MCP server' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ description: 'Optional description' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    description: 'Transport type for connecting to the MCP server',
    enum: ['http', 'stdio', 'sse', 'websocket'],
  })
  @IsOptional()
  @IsEnum(['http', 'stdio', 'sse', 'websocket'])
  transportType?: TransportType;

  @ApiPropertyOptional({ description: 'URL endpoint for HTTP/SSE/WebSocket transports' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  endpoint?: string | null;

  @ApiPropertyOptional({ description: 'Command to run for stdio transport' })
  @IsOptional()
  @IsString()
  command?: string | null;

  @ApiPropertyOptional({ description: 'Arguments for stdio command', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  args?: string[] | null;

  @ApiPropertyOptional({
    description: 'HTTP headers for authentication (will be encrypted). Set to null to clear.',
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
  })
  @IsOptional()
  headers?: Record<string, string> | null;

  @ApiPropertyOptional({ description: 'Custom health check URL (optional)' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  healthCheckUrl?: string | null;

  @ApiPropertyOptional({ description: 'Whether the server is enabled' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class McpServerResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ enum: ['http', 'stdio', 'sse', 'websocket'] })
  transportType!: TransportType;

  @ApiPropertyOptional()
  endpoint?: string | null;

  @ApiPropertyOptional()
  command?: string | null;

  @ApiPropertyOptional({ type: [String] })
  args?: string[] | null;

  @ApiProperty({ description: 'Whether encrypted headers are configured' })
  hasHeaders!: boolean;

  @ApiProperty()
  enabled!: boolean;

  @ApiPropertyOptional()
  healthCheckUrl?: string | null;

  @ApiPropertyOptional()
  lastHealthCheck?: string | null;

  @ApiPropertyOptional({ enum: ['healthy', 'unhealthy', 'unknown'] })
  lastHealthStatus?: HealthStatus | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class McpToolResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  toolName!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional()
  inputSchema?: Record<string, unknown> | null;

  @ApiProperty()
  serverId!: string;

  @ApiProperty()
  serverName!: string;

  @ApiProperty()
  discoveredAt!: string;
}

export class TestConnectionResponse {
  @ApiProperty()
  success!: boolean;

  @ApiPropertyOptional()
  message?: string;

  @ApiPropertyOptional()
  toolCount?: number;
}

export class HealthStatusResponse {
  @ApiProperty()
  serverId!: string;

  @ApiProperty({ enum: ['healthy', 'unhealthy', 'unknown'] })
  status!: HealthStatus;

  @ApiPropertyOptional()
  checkedAt?: string | null;
}
