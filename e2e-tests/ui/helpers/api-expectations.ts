import { apiRequest } from './browser-harness';

// --- Workflow ---

interface WorkflowSummary {
  id: string;
  name: string;
  nodeCount?: number;
  status?: string;
}

export async function getWorkflows(): Promise<{ count: number; firstId: string | null; items: WorkflowSummary[] }> {
  const res = await apiRequest<WorkflowSummary[]>('/workflows/summary');
  const items = Array.isArray(res) ? res : [];
  return {
    count: items.length,
    firstId: items[0]?.id ?? null,
    items,
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

export async function getHumanInputs(status?: 'pending' | 'resolved' | 'expired' | 'cancelled'): Promise<{ count: number }> {
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

export async function getApiKeys(): Promise<{ count: number }> {
  const res = await apiRequest<unknown[]>('/api-keys');
  return { count: Array.isArray(res) ? res.length : 0 };
}

// --- MCP ---

export async function getMcpGroups(): Promise<{ count: number }> {
  const res = await apiRequest<unknown[]>('/mcp-groups');
  return { count: Array.isArray(res) ? res.length : 0 };
}

export async function getMcpServers(): Promise<{ count: number }> {
  const res = await apiRequest<unknown[]>('/mcp-servers');
  return { count: Array.isArray(res) ? res.length : 0 };
}

// --- Workflow Runs ---

interface RunsResponse {
  data: Array<{ id: string; status: string }>;
  total?: number;
}

export async function getWorkflowRuns(workflowId: string): Promise<{ count: number; firstRun: { id: string; status: string } | null }> {
  try {
    const res = await apiRequest<RunsResponse>(`/workflows/${workflowId}/runs`);
    return {
      count: res.data?.length ?? 0,
      firstRun: res.data?.[0] ?? null,
    };
  } catch {
    // 404 when workflow has no runs
    return { count: 0, firstRun: null };
  }
}
