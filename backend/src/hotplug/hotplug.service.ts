import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  createConfig,
  createSession as sdkCreateSession,
  terminateSession as sdkTerminateSession,
  inspectSession as sdkInspectSession,
  health as sdkHealth,
  discover as sdkDiscover,
  type SessionResponse,
  type DiscoverRequest,
  type DiscoverResult,
  type AttachmentInput,
  type IdentityInput,
  type ScopePolicyInput,
  type LifecyclePolicyInput,
} from '@shipsec/hotplug-sdk';

// Re-export SDK types for downstream consumers
export type HotplugDiscoverRequest = DiscoverRequest;
export type HotplugDiscoverResult = DiscoverResult;
export type HotplugSessionState = SessionResponse;

export interface HotplugTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface HotplugPrompt {
  name: string;
  description?: string;
}

export interface HotplugAttachment {
  managed?: {
    runtime: 'docker' | 'host';
    launch: { type: 'stdio'; command: string; args: string[] };
    secrets?: { env_vars?: Record<string, string>; temp_files?: Record<string, string> };
  };
  remote_http?: { url: string; headers?: Record<string, string> };
}

export interface HotplugCreateSessionRequest {
  identity: { tenant_id: string; user_id: string; run_id: string; labels?: Record<string, string> };
  attachments: Record<string, HotplugAttachment>;
  scope?: ScopePolicyInput;
  lifecycle?: LifecyclePolicyInput;
}

export interface HotplugSessionResponse {
  session_id: string;
  state: {
    status: string;
    attachments: Record<string, { status: string; tools: HotplugTool[] }>;
  };
}

@Injectable()
export class HotplugService {
  private readonly logger = new Logger(HotplugService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly sdkClient: ReturnType<typeof createClient>;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('HOTPLUG_URL', 'http://localhost:10011');
    this.token = this.configService.get<string>('HOTPLUG_CONTROL_TOKEN', 'hotplug-local-dev-token');
    this.sdkClient = createClient(
      createConfig({
        baseUrl: this.baseUrl,
        headers: { Authorization: `Bearer ${this.token}` },
      }),
    );
  }

  async health(): Promise<{ status: string }> {
    const { data, error } = await sdkHealth({ client: this.sdkClient });
    if (error || !data) throw new Error(`Hotplug health check failed: ${JSON.stringify(error)}`);
    return data as { status: string };
  }

  async discover(
    input: DiscoverRequest,
    timeoutMs = 120_000,
  ): Promise<{ tools: HotplugTool[]; prompts: HotplugPrompt[] }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { stream } = await sdkDiscover({
        client: this.sdkClient,
        body: input,
        signal: controller.signal,
      });

      let result: { tools: HotplugTool[]; prompts: HotplugPrompt[] } | null = null;
      let error: string | null = null;

      for await (const event of stream) {
        const evt = event as Record<string, unknown>;
        if (evt.tools) {
          result = evt as unknown as { tools: HotplugTool[]; prompts: HotplugPrompt[] };
        } else if (evt.phase && evt.message) {
          const msg = evt.message as string;
          if (msg.toLowerCase().includes('error')) {
            error = msg;
          }
        }
      }

      if (error) throw new Error(`Hotplug discovery error: ${error}`);
      if (!result) throw new Error('Hotplug discover returned no result');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async createSession(input: HotplugCreateSessionRequest): Promise<HotplugSessionResponse> {
    const { data, error } = await sdkCreateSession({
      client: this.sdkClient,
      body: {
        identity: input.identity as IdentityInput,
        attachments: input.attachments as Record<string, AttachmentInput>,
        scope: input.scope,
        lifecycle: input.lifecycle,
      },
    });

    if (error || !data) {
      throw new Error(`Hotplug createSession failed: ${JSON.stringify(error)}`);
    }

    return this.mapSessionResponse(data);
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    const { data, error } = await sdkInspectSession({
      client: this.sdkClient,
      path: { id: sessionId },
    });

    if (error || !data) {
      throw new Error(`Hotplug getSession failed: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const { error } = await sdkTerminateSession({
      client: this.sdkClient,
      path: { id: sessionId },
    });

    if (error) {
      const msg = JSON.stringify(error);
      if (!msg.includes('not_found')) {
        throw new Error(`Hotplug deleteSession failed: ${msg}`);
      }
    }
  }

  sessionMcpEndpoint(sessionId: string): string {
    return `${this.baseUrl}/sessions/${sessionId}/mcp`;
  }

  isHotplugEndpoint(endpoint: string): boolean {
    return endpoint.startsWith(this.baseUrl) && endpoint.includes('/sessions/');
  }

  getAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  private mapSessionResponse(data: SessionResponse): HotplugSessionResponse {
    const attachmentsMap: Record<string, { status: string; tools: HotplugTool[] }> = {};
    for (const att of data.attachments ?? []) {
      attachmentsMap[att.alias] = { status: att.status, tools: [] };
    }
    return {
      session_id: data.session_id,
      state: { status: data.state.status, attachments: attachmentsMap },
    };
  }
}
