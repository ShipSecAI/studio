import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import type { ComponentMetadata } from '@/schemas/component';

interface ComponentIndex {
  byId: Record<string, ComponentMetadata>;
  slugIndex: Record<string, string>;
}

function buildIndexes(components: ComponentMetadata[]): ComponentIndex {
  const byId: Record<string, ComponentMetadata> = {};
  const slugIndex: Record<string, string> = {};

  components.forEach((component) => {
    if (!component?.id || !component?.slug || !component?.name) return;
    byId[component.id] = component;
    slugIndex[component.slug] = component.id;
  });

  return { byId, slugIndex };
}

/** Shared queryFn so prefetch and useComponents produce the same cache shape */
export async function fetchComponentIndex(): Promise<ComponentIndex> {
  const raw = await api.components.list();
  return buildIndexes(raw);
}

export function useComponents() {
  return useQuery({
    queryKey: queryKeys.components.all(),
    queryFn: fetchComponentIndex,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Get a component by ID or slug from the query cache */
export function getComponentFromCache(ref?: string | null): ComponentMetadata | null {
  const data = queryClient.getQueryData<ComponentIndex>(queryKeys.components.all());
  if (!data || !ref) return null;
  if (data.byId[ref]) return data.byId[ref];
  const idFromSlug = data.slugIndex[ref];
  if (idFromSlug && data.byId[idFromSlug]) return data.byId[idFromSlug];
  return null;
}

/** Hook to get a single component by ref (ID or slug) */
export function useComponent(ref?: string | null) {
  const { data } = useComponents();
  if (!data || !ref) return null;
  if (data.byId[ref]) return data.byId[ref];
  const idFromSlug = data.slugIndex[ref];
  if (idFromSlug && data.byId[idFromSlug]) return data.byId[idFromSlug];
  return null;
}

/** Hook to get all components as an array */
export function useAllComponents() {
  const { data } = useComponents();
  return data ? Object.values(data.byId) : [];
}
