export interface HotplugDiscoverRequest {
  managed?: {
    runtime: 'docker' | 'host';
    launch: { type: 'stdio'; command: string; args: string[] };
    secrets?: { env_vars?: Record<string, string>; temp_files?: Record<string, string> };
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

export interface HotplugPrompt {
  name: string;
  description?: string;
}

export interface HotplugDiscoverResult {
  tools: HotplugTool[];
  prompts: HotplugPrompt[];
}

export interface HotplugAttachment {
  managed?: {
    runtime: 'docker' | 'host';
    launch: { type: 'stdio'; command: string; args: string[] };
    secrets?: { env_vars?: Record<string, string>; temp_files?: Record<string, string> };
  };
  remote_http?: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface HotplugCreateSessionRequest {
  identity: {
    tenant_id: string;
    user_id: string;
    run_id: string;
    labels?: Record<string, string>;
  };
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

export interface HotplugSessionState {
  session_id: string;
  state: {
    status: string;
    attachments: Record<string, { status: string; tools: HotplugTool[] }>;
  };
}
