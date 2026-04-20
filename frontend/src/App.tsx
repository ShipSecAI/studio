import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ToastProvider } from '@/components/ui/toast-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthProvider } from '@/auth/auth-context';
import { useAuthStoreIntegration } from '@/auth/store-integration';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AnalyticsRouterListener } from '@/features/analytics/AnalyticsRouterListener';
import { PostHogClerkBridge } from '@/features/analytics/PostHogClerkBridge';
import { useCommandPaletteKeyboard } from '@/features/command-palette/useCommandPaletteKeyboard';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { Skeleton } from '@/components/ui/skeleton';
import { env } from '@/config/env';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FeatureFlagProvider, FeatureFlagRoute } from '@/features/feature-flags';

const ReactQueryDevtools = lazy(() =>
  import('@tanstack/react-query-devtools').then((mod) => ({
    default: mod.ReactQueryDevtools,
  })),
);
const CommandPalette = lazy(() =>
  import('@/features/command-palette/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);

// Lazy-loaded page components
const ChatInterface = lazy(() =>
  import('@/pages/ChatInterface').then((m) => ({ default: m.ChatInterface })),
);
const WorkflowList = lazy(() =>
  import('@/pages/WorkflowList').then((m) => ({ default: m.WorkflowList })),
);
const WorkflowBuilder = lazy(() =>
  import('@/features/workflow-builder/WorkflowBuilder').then((m) => ({
    default: m.WorkflowBuilder,
  })),
);
const SecretsManager = lazy(() =>
  import('@/pages/SecretsManager').then((m) => ({ default: m.SecretsManager })),
);
const ApiKeysManager = lazy(() =>
  import('@/pages/ApiKeysManager').then((m) => ({ default: m.ApiKeysManager })),
);
const IntegrationsPage = lazy(() =>
  import('@/pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);
const ArtifactLibrary = lazy(() =>
  import('@/pages/ArtifactLibrary').then((m) => ({ default: m.ArtifactLibrary })),
);
const McpLibraryPage = lazy(() =>
  import('@/pages/McpLibraryPage').then((m) => ({ default: m.McpLibraryPage })),
);
const AgentSkillsPage = lazy(() =>
  import('@/pages/AgentSkillsPage').then((m) => ({ default: m.AgentSkillsPage })),
);
const IntegrationCallback = lazy(() =>
  import('@/pages/IntegrationCallback').then((m) => ({ default: m.IntegrationCallback })),
);
const NotFound = lazy(() => import('@/pages/NotFound').then((m) => ({ default: m.NotFound })));
const WebhooksPage = lazy(() =>
  import('@/pages/WebhooksPage').then((m) => ({ default: m.WebhooksPage })),
);
const WebhookEditorPage = lazy(() =>
  import('@/pages/WebhookEditorPage').then((m) => ({ default: m.WebhookEditorPage })),
);
const SchedulesPage = lazy(() =>
  import('@/pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })),
);
const ActionCenterPage = lazy(() =>
  import('@/pages/ActionCenterPage').then((m) => ({ default: m.ActionCenterPage })),
);
const RunRedirect = lazy(() =>
  import('@/pages/RunRedirect').then((m) => ({ default: m.RunRedirect })),
);
const AnalyticsSettingsPage = lazy(() =>
  import('@/pages/AnalyticsSettingsPage').then((m) => ({ default: m.AnalyticsSettingsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const GitHubPage = lazy(() =>
  import('@/pages/GitHubPage').then((m) => ({ default: m.GitHubPage })),
);
const ScanResultPage = lazy(() =>
  import('@/pages/ScanResultPage').then((m) => ({ default: m.ScanResultPage })),
);
const CreateTriggerRulePage = lazy(() => import('@/pages/CreateTriggerRulePage'));
const EditTriggerRulePage = lazy(() => import('@/pages/EditTriggerRulePage'));
const IntegrationDetailPage = lazy(() =>
  import('@/pages/IntegrationDetailPage').then((m) => ({ default: m.IntegrationDetailPage })),
);
const GitHubIntegrationPage = lazy(() =>
  import('@/pages/GitHubIntegrationPage').then((m) => ({ default: m.GitHubIntegrationPage })),
);
const SecurityDashboard = lazy(() =>
  import('@/pages/SecurityDashboard').then((m) => ({ default: m.SecurityDashboardContent })),
);
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const WorkflowTemplatesPage = lazy(() =>
  import('@/pages/WorkflowTemplatesPage').then((m) => ({ default: m.WorkflowTemplatesPage })),
);
const ReportTemplatesPage = lazy(() =>
  import('@/pages/ReportTemplatesPage').then((m) => ({ default: m.ReportTemplatesPage })),
);
const CloudAccountsPage = lazy(() =>
  import('@/pages/CloudAccountsPage').then((m) => ({ default: m.CloudAccountsPage })),
);
const CloudInventoryPage = lazy(() =>
  import('@/pages/CloudInventoryPage').then((m) => ({ default: m.CloudInventoryPage })),
);
const ActivityPage = lazy(() => import('@/pages/ActivityPage'));
const DomainsPage = lazy(() =>
  import('@/pages/asm/DomainsPage').then((m) => ({ default: m.DomainsPage })),
);
const AssetsPage = lazy(() =>
  import('@/pages/asm/AssetsPage').then((m) => ({ default: m.AssetsPage })),
);
const AsmScansPage = lazy(() =>
  import('@/pages/asm/AsmScansPage').then((m) => ({ default: m.AsmScansPage })),
);

function AuthIntegration({ children }: { children: React.ReactNode }) {
  useAuthStoreIntegration();
  return <>{children}</>;
}

function PageSkeleton() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="h-[52px] border-b flex items-center px-4 gap-4">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="flex-1 p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  useCommandPaletteKeyboard();
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  // Track whether the palette has ever been opened so we keep it mounted after first use
  const hasOpened = React.useRef(false);
  if (isOpen) hasOpened.current = true;
  return (
    <>
      {children}
      {hasOpened.current && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AuthIntegration>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastProvider>
              <TooltipProvider>
                <CommandPaletteProvider>
                  {/* Analytics wiring */}
                  <AnalyticsRouterListener />
                  <PostHogClerkBridge />
                  <FeatureFlagProvider>
                    <AppLayout>
                      <ProtectedRoute>
                        <ErrorBoundary resetOnNavigate>
                          <Suspense fallback={<PageSkeleton />}>
                            <Routes>
                              {/* Always-on routes */}
                              <Route path="/" element={<HomePage />} />
                              <Route path="/activity" element={<ActivityPage />} />
                              <Route path="/settings/*" element={<SettingsPage />} />
                              <Route path="/runs/:runId" element={<RunRedirect />} />
                              <Route
                                path="/integrations/callback/:provider"
                                element={<IntegrationCallback />}
                              />

                              {/* AI Agent — gated */}
                              <Route element={<FeatureFlagRoute flag="AI_AGENT" />}>
                                <Route path="/chat" element={<ChatInterface />} />
                                <Route path="/chat/:sessionId" element={<ChatInterface />} />
                              </Route>

                              {/* Workflows — gated */}
                              <Route element={<FeatureFlagRoute flag="WORKFLOWS" />}>
                                <Route path="/builder" element={<WorkflowList />} />
                                <Route
                                  path="/workflows/:id"
                                  element={
                                    <ProtectedRoute>
                                      <WorkflowBuilder />
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/workflows/:id/runs"
                                  element={
                                    <ProtectedRoute>
                                      <WorkflowBuilder />
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/workflows/:id/runs/:runId"
                                  element={
                                    <ProtectedRoute>
                                      <WorkflowBuilder />
                                    </ProtectedRoute>
                                  }
                                />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="WORKFLOW_TEMPLATES" />}>
                                <Route path="/templates" element={<WorkflowTemplatesPage />} />
                                <Route path="/report-templates" element={<ReportTemplatesPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="WORKFLOW_SCHEDULES" />}>
                                <Route path="/schedules" element={<SchedulesPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="ACTION_CENTER" />}>
                                <Route path="/action-center" element={<ActionCenterPage />} />
                              </Route>

                              {/* Webhooks — gated (depends on Workflows via registry) */}
                              <Route element={<FeatureFlagRoute flag="WEBHOOKS" />}>
                                <Route path="/webhooks" element={<WebhooksPage />} />
                                <Route path="/webhooks/new" element={<WebhookEditorPage />} />
                                <Route path="/webhooks/:id" element={<WebhookEditorPage />} />
                                <Route
                                  path="/webhooks/:id/deliveries"
                                  element={<WebhookEditorPage />}
                                />
                                <Route
                                  path="/webhooks/:id/settings"
                                  element={<WebhookEditorPage />}
                                />
                              </Route>

                              {/* GitHub / Code Security — gated */}
                              <Route element={<FeatureFlagRoute flag="GITHUB_INTEGRATION" />}>
                                <Route
                                  path="/github"
                                  element={<Navigate to="/github/repositories" replace />}
                                />
                                <Route path="/github/repositories" element={<GitHubPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="CODE_SCANS" />}>
                                <Route path="/github/scans" element={<GitHubPage />} />
                                <Route path="/github/scans/:id" element={<ScanResultPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="PR_PROTECTION" />}>
                                <Route path="/github/triggers" element={<GitHubPage />} />
                                <Route
                                  path="/github/triggers/new"
                                  element={<CreateTriggerRulePage />}
                                />
                                <Route
                                  path="/github/triggers/:id"
                                  element={<EditTriggerRulePage />}
                                />
                              </Route>

                              {/* Cloud Security — gated */}
                              <Route element={<FeatureFlagRoute flag="CLOUD_SECURITY" />}>
                                <Route path="/cloud/accounts" element={<CloudAccountsPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="CLOUD_INVENTORY" />}>
                                <Route path="/cloud/inventory" element={<CloudInventoryPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="CLOUD_SCANS" />}>
                                <Route path="/cloud/scans" element={<CloudAccountsPage />} />
                              </Route>

                              {/* ASM — gated */}
                              <Route element={<FeatureFlagRoute flag="ASM" />}>
                                <Route
                                  path="/recon"
                                  element={<Navigate to="/asm/domains" replace />}
                                />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="ASM_DOMAINS" />}>
                                <Route path="/asm/domains" element={<DomainsPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="ASM_ASSETS" />}>
                                <Route path="/asm/assets" element={<AssetsPage />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="ASM_SCANS" />}>
                                <Route path="/asm/scans" element={<AsmScansPage />} />
                              </Route>

                              {/* Security Dashboard — gated */}
                              <Route element={<FeatureFlagRoute flag="SECURITY_DASHBOARD" />}>
                                <Route
                                  path="/dashboards/security"
                                  element={<SecurityDashboard />}
                                />
                              </Route>

                              {/* Settings sub-pages — individually gated */}
                              <Route element={<FeatureFlagRoute flag="SECRETS" />}>
                                <Route path="/secrets" element={<SecretsManager />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="API_KEYS" />}>
                                <Route path="/api-keys" element={<ApiKeysManager />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="INTEGRATIONS" />}>
                                <Route path="/integrations" element={<IntegrationsPage />} />
                                <Route
                                  path="/integrations/github"
                                  element={<GitHubIntegrationPage />}
                                />
                                <Route
                                  path="/integrations/:provider"
                                  element={<IntegrationDetailPage />}
                                />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="MCP_SERVERS" />}>
                                <Route path="/mcp-library" element={<McpLibraryPage />} />
                              </Route>
                              <Route path="/agent-skills" element={<AgentSkillsPage />} />
                              <Route element={<FeatureFlagRoute flag="ARTIFACTS" />}>
                                <Route path="/artifacts" element={<ArtifactLibrary />} />
                              </Route>
                              <Route element={<FeatureFlagRoute flag="ANALYTICS_SETTINGS" />}>
                                <Route
                                  path="/analytics-settings"
                                  element={<AnalyticsSettingsPage />}
                                />
                              </Route>

                              <Route path="*" element={<NotFound />} />
                            </Routes>
                          </Suspense>
                        </ErrorBoundary>
                      </ProtectedRoute>
                    </AppLayout>
                  </FeatureFlagProvider>
                </CommandPaletteProvider>
              </TooltipProvider>
            </ToastProvider>
          </BrowserRouter>
          {import.meta.env.DEV && env.VITE_ENABLE_DEVTOOLS && (
            <Suspense fallback={null}>
              <ReactQueryDevtools />
            </Suspense>
          )}
        </QueryClientProvider>
      </AuthIntegration>
    </AuthProvider>
  );
}

export default App;
