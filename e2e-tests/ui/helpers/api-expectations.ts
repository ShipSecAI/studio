import { apiRequest } from './browser-harness';

// --- Workflow ---

interface WorkflowSummary {
  id: string;
  name: string;
  nodeCount?: number;
  status?: string;
}

interface WorkflowsResponse {
  data: WorkflowSummary[];
  total?: number;
}

export async function getWorkflows(): Promise<{ count: number; firstId: string | null; items: WorkflowSummary[] }> {
  const res = await apiRequest<WorkflowsResponse>('/workflows/summary');
  return {
    count: res.data?.length ?? 0,
    firstId: res.data?.[0]?.id ?? null,
    items: res.data ?? [],
  };
}

// --- Schedules ---

interface SchedulesResponse {
  data: unknown[];
  total?: number;
}

export async function getSchedules(): Promise<{ count: number }> {
  const res = await apiRequest<SchedulesResponse>('/schedules');
  return { count: res.data?.length ?? 0 };
}

// --- Webhooks ---

interface WebhooksResponse {
  data: unknown[];
  total?: number;
}

export async function getWebhooks(): Promise<{ count: number }> {
  const res = await apiRequest<WebhooksResponse>('/webhooks/configurations');
  return { count: res.data?.length ?? 0 };
}

// --- Action Center (Human Inputs) ---

interface HumanInputsResponse {
  data: unknown[];
  total?: number;
}

export async function getHumanInputs(status?: string): Promise<{ count: number }> {
  const query = status ? `?status=${status}` : '';
  const res = await apiRequest<HumanInputsResponse>(`/human-inputs${query}`);
  return { count: res.data?.length ?? 0 };
}

// --- Artifacts ---

interface ArtifactsResponse {
  data: unknown[];
  total?: number;
}

export async function getArtifacts(): Promise<{ count: number }> {
  const res = await apiRequest<ArtifactsResponse>('/artifacts');
  return { count: res.data?.length ?? 0 };
}

// --- Secrets ---

interface SecretsResponse {
  data: unknown[];
  total?: number;
}

export async function getSecrets(): Promise<{ count: number }> {
  const res = await apiRequest<SecretsResponse>('/secrets');
  return { count: res.data?.length ?? 0 };
}

// --- API Keys ---

interface ApiKeysResponse {
  data: unknown[];
  total?: number;
}

export async function getApiKeys(): Promise<{ count: number }> {
  const res = await apiRequest<ApiKeysResponse>('/api-keys');
  return { count: res.data?.length ?? 0 };
}

// --- MCP ---

interface McpGroupsResponse {
  data: unknown[];
}

interface McpServersResponse {
  data: unknown[];
}

export async function getMcpGroups(): Promise<{ count: number }> {
  const res = await apiRequest<McpGroupsResponse>('/mcp/groups');
  return { count: res.data?.length ?? 0 };
}

export async function getMcpServers(): Promise<{ count: number }> {
  const res = await apiRequest<McpServersResponse>('/mcp/servers');
  return { count: res.data?.length ?? 0 };
}

// --- Workflow Runs ---

interface RunsResponse {
  data: Array<{ id: string; status: string }>;
  total?: number;
}

export async function getWorkflowRuns(workflowId: string): Promise<{ count: number; firstRun: { id: string; status: string } | null }> {
  const res = await apiRequest<RunsResponse>(`/workflows/${workflowId}/runs`);
  return {
    count: res.data?.length ?? 0,
    firstRun: res.data?.[0] ?? null,
  };
}
