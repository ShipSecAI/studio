import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
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

export function useAgentSkills() {
  return useQuery({
    queryKey: queryKeys.agentSkills.all(),
    queryFn: () => api.agentSkills.list() as Promise<AgentSkillResponse[]>,
    staleTime: 120_000,
  });
}

export function useAgentSkill(id: string) {
  return useQuery({
    queryKey: queryKeys.agentSkills.detail(id),
    queryFn: () => api.agentSkills.get(id) as Promise<AgentSkillResponse>,
    enabled: !!id,
  });
}

export function useCreateAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentSkillInput) =>
      api.agentSkills.create(input) as Promise<AgentSkillResponse>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useUpdateAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAgentSkillInput }) =>
      api.agentSkills.update(id, input) as Promise<AgentSkillResponse>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useDeleteAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.agentSkills.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function useToggleAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.agentSkills.toggle(id) as Promise<AgentSkillResponse>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.agentSkills.all() });
    },
  });
}

export function usePreviewAgentSkill(id: string) {
  return useQuery({
    queryKey: [...queryKeys.agentSkills.detail(id), 'preview'],
    queryFn: () => api.agentSkills.preview(id) as Promise<{ content: string }>,
    enabled: !!id,
  });
}
