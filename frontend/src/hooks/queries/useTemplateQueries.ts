import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { Template, TemplateCategory } from '@/store/templateStore';

export type { Template, TemplateCategory } from '@/store/templateStore';

export function useTemplates(filters?: { category?: string; search?: string; tags?: string[] }) {
  return useQuery<Template[]>({
    queryKey: queryKeys.templates.all(filters as Record<string, unknown>),
    queryFn: () => api.templates.list(filters),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useTemplateCategories() {
  return useQuery<TemplateCategory[]>({
    queryKey: queryKeys.templates.categories(),
    queryFn: () => api.templates.getCategories(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useTemplateTags() {
  return useQuery<string[]>({
    queryKey: queryKeys.templates.tags(),
    queryFn: () => api.templates.getTags(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSyncTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.templates.sync(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['templateCategories'] });
      qc.invalidateQueries({ queryKey: ['templateTags'] });
    },
  });
}

export function useUseTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      workflowName,
      secretMappings,
    }: {
      templateId: string;
      workflowName: string;
      secretMappings?: Record<string, string>;
    }) => api.templates.use(templateId, { workflowName, secretMappings }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });
}
