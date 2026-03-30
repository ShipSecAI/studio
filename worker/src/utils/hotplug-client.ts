/**
 * Hotplug client for Temporal worker activities.
 * Thin wrapper around @shipsecai/hotplug SDK with class-based API.
 */

import {
  createClient,
  createConfig,
  createSession as sdkCreateSession,
  terminateSession as sdkTerminateSession,
  discover as sdkDiscover,
  type SessionResponse,
  type DiscoverRequest,
  type DiscoverResult,
  type AttachmentInput,
  type IdentityInput,
  type ScopePolicyInput,
  type LifecyclePolicyInput,
} from '@shipsecai/hotplug';

// --- Backwards-compatible type aliases ---

export interface HotplugTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
export interface HotplugPrompt {
  name: string;
  description?: string;
}
export type HotplugDiscoverResult = DiscoverResult;
export type HotplugDiscoverRequest = DiscoverRequest;

export interface HotplugAttachment {
  managed?: {
    runtime: 'docker' | 'host';
    launch: { type: 'stdio'; command: string; args: string[] };
    secrets?: { env_vars?: Record<string, string> };
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
  mcp_token?: string;
  state: {
    status: string;
    attachments: Record<string, { status: string; tools: HotplugTool[] }>;
  };
}

export class HotplugClient {
  public readonly baseUrl: string;
  private readonly sdkClient: ReturnType<typeof createClient>;

  constructor(
    baseUrl = process.env.HOTPLUG_URL || 'http://localhost:10011',
    token = process.env.HOTPLUG_CONTROL_TOKEN || 'hotplug-local-dev-token',
  ) {
    this.baseUrl = baseUrl;
    this.sdkClient = createClient(
      createConfig({
        baseUrl,
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  }

  async discover(
    input: HotplugDiscoverRequest,
    timeoutMs = 300_000,
  ): Promise<HotplugDiscoverResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      console.warn(`[HotplugClient] discover timeout after ${timeoutMs}ms — aborting`);
      controller.abort();
    }, timeoutMs);

    console.log(
      `[HotplugClient] discover start url=${this.baseUrl} runtime=${(input as any).managed?.runtime ?? 'unknown'} timeout=${timeoutMs}ms`,
    );

    try {
      const { stream } = await sdkDiscover({
        client: this.sdkClient,
        body: input,
        signal: controller.signal,
      });

      let result: HotplugDiscoverResult | null = null;
      let error: string | null = null;
      let eventCount = 0;

      for await (const event of stream) {
        eventCount++;
        const evt = event as Record<string, unknown>;
        console.log(`[HotplugClient] SSE event #${eventCount}: ${JSON.stringify(evt)}`);
        if (evt.tools) {
          console.log(
            `[HotplugClient] Got result event with ${(evt.tools as unknown[]).length} tools`,
          );
          result = evt as unknown as HotplugDiscoverResult;
        } else if (evt.phase && evt.message) {
          const msg = evt.message as string;
          console.log(`[HotplugClient] Progress [${evt.phase}]: ${msg}`);
          if (msg.toLowerCase().includes('error')) {
            error = msg;
          }
        }
      }

      console.log(
        `[HotplugClient] stream ended after ${eventCount} events, result=${result ? 'OK' : 'null'}, error=${error}`,
      );

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

  private mapSessionResponse(data: SessionResponse): HotplugSessionResponse {
    const attachmentsMap: Record<string, { status: string; tools: HotplugTool[] }> = {};
    for (const att of data.attachments ?? []) {
      attachmentsMap[att.alias] = { status: att.status, tools: [] };
    }
    return {
      session_id: data.session_id,
      mcp_token: (data as any).mcp_token,
      state: { status: data.state.status, attachments: attachmentsMap },
    };
  }
}
