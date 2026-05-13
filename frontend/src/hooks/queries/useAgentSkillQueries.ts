import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiAuthHeaders, API_BASE_URL } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export interface AgentSkillResponse {
  id: string;
  name: string;
  description: string;
  content: string;
  files: { path: string; content: string; executable?: boolean }[];
  license?: string | null;
  compatibility?: string | null;
  metadata?: Record<string, unknown> | null;
  allowedTools?: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentSkillInput {
  name: string;
  description: string;
  content: string;
  files?: { path: string; content: string; executable?: boolean }[];
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  allowedTools?: string;
  isEnabled?: boolean;
}

export interface UpdateAgentSkillInput {
  name?: string;
  description?: string;
  content?: string;
  files?: { path: string; content: string; executable?: boolean }[];
  license?: string | null;
  compatibility?: string | null;
  metadata?: Record<string, unknown> | null;
  allowedTools?: string | null;
  isEnabled?: boolean;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getApiAuthHeaders();
  const { signal, ...restOptions } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...restOptions,
    signal,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function useAgentSkills() {
  return useQuery({
    queryKey: queryKeys.agentSkills.all(),
    queryFn: () => apiRequest<AgentSkillResponse[]>('/api/v1/agent-skills'),
    staleTime: 120_000,
  });
}

export function useAgentSkill(id: string) {
  return useQuery({
    queryKey: queryKeys.agentSkills.detail(id),
    queryFn: () => apiRequest<AgentSkillResponse>(`/api/v1/agent-skills/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentSkillInput) =>
      apiRequest<AgentSkillResponse>('/api/v1/agent-skills', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useUpdateAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAgentSkillInput }) =>
      apiRequest<AgentSkillResponse>(`/api/v1/agent-skills/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useDeleteAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest(`/api/v1/agent-skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useToggleAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<AgentSkillResponse>(`/api/v1/agent-skills/${id}/toggle`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function usePreviewAgentSkill(id: string) {
  return useQuery({
    queryKey: [...queryKeys.agentSkills.detail(id), 'preview'],
    queryFn: () => apiRequest<{ content: string }>(`/api/v1/agent-skills/${id}/preview`),
    enabled: !!id,
  });
}
