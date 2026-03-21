/**
 * Lightweight Hotplug HTTP client for Temporal worker activities.
 * Hotplug manages MCP server lifecycles (Docker containers, stdio bridging).
 */

export interface HotplugDiscoverRequest {
  managed?: {
    runtime: 'docker' | 'host';
    launch: { type: 'stdio'; command: string; args: string[] };
    secrets?: { env_vars?: Record<string, string> };
  };
  remote_http?: {
    url: string;
    headers?: Record<string, string>;
  };
  startup_timeout_ms?: number;
}

export interface HotplugTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface HotplugDiscoverResult {
  tools: HotplugTool[];
  prompts: { name: string; description?: string }[];
}

export interface HotplugAttachment {
  managed?: {
    runtime: 'docker' | 'host';
    launch: { type: 'stdio'; command: string; args: string[] };
    secrets?: { env_vars?: Record<string, string> };
  };
  remote_http?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface HotplugCreateSessionRequest {
  identity: { tenant_id: string; user_id: string; run_id: string; labels?: Record<string, string> };
  attachments: Record<string, HotplugAttachment>;
  scope?: {
    allowed_tools?: { type: string; value: string }[];
    denied_tools?: { type: string; value: string }[];
  };
  lifecycle?: {
    startup_timeout_ms?: number;
    idle_ttl_ms?: number;
    max_duration_ms?: number;
  };
}

export interface HotplugSessionResponse {
  session_id: string;
  state: {
    status: string;
    attachments: Record<string, { status: string; tools: HotplugTool[] }>;
  };
}

export class HotplugClient {
  public readonly baseUrl: string;
  private readonly token: string;

  constructor(
    baseUrl = process.env.HOTPLUG_URL || 'http://localhost:3230',
    token = process.env.HOTPLUG_CONTROL_TOKEN || 'hotplug-local-dev-token',
  ) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Ephemeral tool discovery via SSE stream.
   * Hotplug spins up an MCP server, enumerates tools/prompts, tears it down.
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
   * Returns the activated session with MCP URL and token.
   */
  async createSession(input: HotplugCreateSessionRequest): Promise<HotplugSessionResponse> {
    // Step 1: Create empty session
    const createBody: Record<string, unknown> = {
      identity: input.identity,
    };
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
    for (const [alias, attachment] of Object.entries(input.attachments)) {
      const attachBody: Record<string, unknown> = { alias, ...attachment };
      const attachRes = await fetch(`${this.baseUrl}/sessions/${sessionId}/attachments`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(attachBody),
      });
      if (!attachRes.ok) {
        const body = await attachRes.text();
        // Clean up on failure
        await this.deleteSession(sessionId).catch(() => {});
        throw new Error(`Hotplug attach "${alias}" failed (${attachRes.status}): ${body}`);
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
}
