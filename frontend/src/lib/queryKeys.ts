import { useAuthStore } from '@/store/authStore';

const getOrgScope = () => useAuthStore.getState().organizationId || '__no-org__';
const getUserScope = () => useAuthStore.getState().userId || '__no-user__';

export const queryKeys = {
  secrets: {
    all: () => ['secrets', getOrgScope()] as const,
    detail: (id: string) => ['secrets', getOrgScope(), id] as const,
  },
  components: {
    all: () => ['components', getOrgScope()] as const,
  },
  runs: {
    byWorkflow: (workflowId: string) => ['runs', getOrgScope(), workflowId] as const,
    global: () => ['runs', getOrgScope(), '__global__'] as const,
    detail: (runId: string) => ['runs', getOrgScope(), 'detail', runId] as const,
    activity: (filters?: Record<string, unknown>) =>
      ['runs', getOrgScope(), 'activity', filters] as const,
  },
  schedules: {
    all: (filters?: Record<string, unknown>) => ['schedules', getOrgScope(), filters] as const,
  },
  mcpServers: {
    all: () => ['mcpServers', getOrgScope()] as const,
    tools: () => ['mcpServers', getOrgScope(), 'tools'] as const,
  },
  mcpGroups: {
    all: () => ['mcpGroups', getOrgScope()] as const,
    servers: (groupId: string) => ['mcpGroupServers', getOrgScope(), groupId] as const,
    templates: () => ['mcpGroupTemplates', getOrgScope()] as const,
  },
  integrations: {
    providers: () => ['integrationProviders', getOrgScope()] as const,
    connections: (userId?: string) =>
      ['integrationConnections', getOrgScope(), userId || getUserScope()] as const,
    providerConfig: (providerId: string) => ['providerConfig', getOrgScope(), providerId] as const,
  },
  apiKeys: {
    all: () => ['apiKeys', getOrgScope()] as const,
  },
  webhooks: {
    all: (filters?: Record<string, unknown>) => ['webhooks', getOrgScope(), filters] as const,
    detail: (id: string) => ['webhooks', getOrgScope(), id] as const,
  },
  artifacts: {
    library: (filters?: Record<string, unknown>) =>
      ['artifactLibrary', getOrgScope(), filters] as const,
    byRun: (runId: string) => ['runArtifacts', getOrgScope(), runId] as const,
  },
  humanInputs: {
    all: (filters?: Record<string, unknown>) => ['humanInputs', getOrgScope(), filters] as const,
  },
  executions: {
    nodeIO: (runId: string) => ['executionNodeIO', getOrgScope(), runId] as const,
    result: (runId: string) => ['executionResult', getOrgScope(), runId] as const,
    run: (runId: string) => ['executionRun', getOrgScope(), runId] as const,
    status: (runId: string) => ['executionStatus', getOrgScope(), runId] as const,
    trace: (runId: string) => ['executionTrace', getOrgScope(), runId] as const,
    events: (runId: string) => ['executionEvents', getOrgScope(), runId] as const,
    dataFlows: (runId: string) => ['executionDataFlows', getOrgScope(), runId] as const,
    terminalChunks: (runId: string, nodeRef: string, stream: string) =>
      ['executionTerminal', getOrgScope(), runId, nodeRef, stream] as const,
  },
  workflows: {
    list: () => ['workflows', getOrgScope()] as const,
    summary: () => ['workflowsSummary', getOrgScope()] as const,
    detail: (id: string) => ['workflow', getOrgScope(), id] as const,
    runtimeInputs: (workflowId: string) =>
      ['workflowRuntimeInputs', getOrgScope(), workflowId] as const,
  },
  security: {
    findings: (filters?: unknown, viewFilter?: unknown) =>
      ['security', getOrgScope(), 'findings', filters, viewFilter] as const,
    timeSeries: (filters?: unknown, viewFilter?: unknown, interval?: string) =>
      ['security', getOrgScope(), 'timeSeries', filters, viewFilter, interval] as const,
    findingDetail: (docId: string) => ['security', getOrgScope(), 'findingDetail', docId] as const,
    findingLifecycle: (hash: string) =>
      ['security', getOrgScope(), 'findingLifecycle', hash] as const,
    batchLifecycles: (hashes: string[]) =>
      ['security', getOrgScope(), 'batchLifecycles', [...hashes].sort()] as const,
    timeSeriesHeatmap: (days: number) =>
      ['security', getOrgScope(), 'timeSeriesHeatmap', days] as const,
    categoryCounts: () => ['security', getOrgScope(), 'categoryCounts'] as const,
    summary: (viewFilter?: unknown) => ['security', getOrgScope(), 'summary', viewFilter] as const,
  },
  cloud: {
    scans: (filters?: { status?: string; offset?: number; limit?: number; workflowIds?: string }) =>
      ['cloud', getOrgScope(), 'scans', filters] as const,
    scanFindings: (runId: string) => ['cloud', getOrgScope(), 'scanFindings', runId] as const,
    scanSummaries: (runIds: string[]) =>
      ['cloud', getOrgScope(), 'scanSummaries', [...runIds].sort()] as const,
  },
  github: {
    status: () => ['github', getOrgScope(), 'status'] as const,
    installations: () => ['github', getOrgScope(), 'installations'] as const,
    repositories: () => ['github', getOrgScope(), 'repositories'] as const,
    branches: (repoId: string) => ['github', getOrgScope(), 'branches', repoId] as const,
    triggerRules: () => ['github', getOrgScope(), 'triggerRules'] as const,
    scans: (filters?: Record<string, unknown>) =>
      ['github', getOrgScope(), 'scans', filters] as const,
    scan: (id: string) => ['github', getOrgScope(), 'scan', id] as const,
  },
} as const;
