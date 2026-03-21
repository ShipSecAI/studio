import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  HotplugCreateSessionRequest,
  HotplugDiscoverRequest,
  HotplugDiscoverResult,
  HotplugSessionResponse,
  HotplugSessionState,
} from './hotplug.types';

@Injectable()
export class HotplugService {
  private readonly logger = new Logger(HotplugService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('HOTPLUG_URL', 'http://localhost:3230');
    this.token = this.configService.get<string>('HOTPLUG_CONTROL_TOKEN', 'hotplug-local-dev-token');
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async health(): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Hotplug health check failed: ${res.status}`);
    return res.json() as Promise<{ status: string }>;
  }

  /**
   * Ephemeral tool discovery. Hotplug spins up an MCP server, enumerates tools, tears it down.
   * Returns SSE stream — we parse it and return the final result.
   */
  async discover(
    input: HotplugDiscoverRequest,
    timeoutMs = 120_000,
  ): Promise<HotplugDiscoverResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/discover`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Hotplug discover failed (${res.status}): ${body}`);
      }

      // Parse SSE stream
      const text = await res.text();
      const lines = text.split('\n');
      let result: HotplugDiscoverResult | null = null;
      let error: string | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('event: result')) {
          const dataLine = lines[i + 1];
          if (dataLine?.startsWith('data: ')) {
            result = JSON.parse(dataLine.slice(6));
          }
        } else if (line.startsWith('event: error')) {
          const dataLine = lines[i + 1];
          if (dataLine?.startsWith('data: ')) {
            const parsed = JSON.parse(dataLine.slice(6));
            error = parsed.message || JSON.stringify(parsed);
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

  /**
   * Create a Hotplug session with MCP server attachments.
   * Chains three API calls: create → attach (per attachment) → activate.
   */
  async createSession(input: HotplugCreateSessionRequest): Promise<HotplugSessionResponse> {
    // Step 1: Create empty session
    const createBody: Record<string, unknown> = { identity: input.identity };
    if (input.scope) createBody.scope = input.scope;
    if (input.lifecycle) createBody.lifecycle = input.lifecycle;

    const createRes = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(createBody),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Hotplug createSession failed (${createRes.status}): ${body}`);
    }
    const session = (await createRes.json()) as HotplugSessionResponse;
    const sessionId = session.session_id;

    // Step 2: Attach each attachment
    if (input.attachments) {
      for (const [alias, attachment] of Object.entries(input.attachments)) {
        const attachBody: Record<string, unknown> = { alias, ...attachment };
        const attachRes = await fetch(`${this.baseUrl}/sessions/${sessionId}/attachments`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(attachBody),
        });
        if (!attachRes.ok) {
          const body = await attachRes.text();
          await this.deleteSession(sessionId).catch(() => {});
          throw new Error(`Hotplug attach "${alias}" failed (${attachRes.status}): ${body}`);
        }
      }
    }

    // Step 3: Activate
    const activateRes = await fetch(`${this.baseUrl}/sessions/${sessionId}/activate`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!activateRes.ok) {
      const body = await activateRes.text();
      await this.deleteSession(sessionId).catch(() => {});
      throw new Error(`Hotplug activate failed (${activateRes.status}): ${body}`);
    }

    return (await activateRes.json()) as HotplugSessionResponse;
  }

  /**
   * Get session state.
   */
  async getSession(sessionId: string): Promise<HotplugSessionState> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Hotplug getSession failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<HotplugSessionState>;
  }

  /**
   * Terminate a session and all its containers.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: this.headers,
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Hotplug deleteSession failed (${res.status}): ${body}`);
    }
  }

  /**
   * Get the MCP proxy endpoint URL for a session.
   */
  sessionMcpEndpoint(sessionId: string): string {
    return `${this.baseUrl}/sessions/${sessionId}/mcp`;
  }

  /**
   * Check if an endpoint is a Hotplug session endpoint.
   */
  isHotplugEndpoint(endpoint: string): boolean {
    return endpoint.startsWith(this.baseUrl) && endpoint.includes('/sessions/');
  }

  /**
   * Get authorization headers for Hotplug-managed endpoints.
   */
  getAuthHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }
}
