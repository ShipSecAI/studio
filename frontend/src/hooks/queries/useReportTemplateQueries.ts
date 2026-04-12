import { skipToken, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export function useReportTemplates() {
  return useQuery({
    queryKey: queryKeys.reportTemplates.list(),
    queryFn: () => api.reportTemplates.list(),
    staleTime: 60_000,
  });
}

export function useReportTemplate(templateId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reportTemplates.detail(templateId ?? ''),
    queryFn: templateId ? () => api.reportTemplates.get(templateId) : skipToken,
    staleTime: 60_000,
    ...(templateId ? {} : { gcTime: 0 }),
  });
}

export function useReportTemplatePreview(
  templateId: string | undefined,
  data: Record<string, unknown> | undefined,
) {
  return useQuery({
    queryKey: queryKeys.reportTemplates.preview(templateId ?? '', data),
    queryFn:
      templateId && data ? () => api.reportTemplates.preview(templateId, { data }) : skipToken,
    staleTime: 30_000,
    ...(templateId && data ? {} : { gcTime: 0 }),
  });
}
