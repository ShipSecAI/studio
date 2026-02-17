import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/toast-provider';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthProvider } from '@/auth/auth-context';
import { useAuthStoreIntegration } from '@/auth/store-integration';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AnalyticsRouterListener } from '@/features/analytics/AnalyticsRouterListener';
import { PostHogClerkBridge } from '@/features/analytics/PostHogClerkBridge';
import { CommandPalette, useCommandPaletteKeyboard } from '@/features/command-palette';

// Lazy-loaded page components
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
const IntegrationsManager = lazy(() =>
  import('@/pages/IntegrationsManager').then((m) => ({ default: m.IntegrationsManager })),
);
const ArtifactLibrary = lazy(() =>
  import('@/pages/ArtifactLibrary').then((m) => ({ default: m.ArtifactLibrary })),
);
const McpLibraryPage = lazy(() =>
  import('@/pages/McpLibraryPage').then((m) => ({ default: m.McpLibraryPage })),
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

function AuthIntegration({ children }: { children: React.ReactNode }) {
  useAuthStoreIntegration();
  return <>{children}</>;
}

function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  useCommandPaletteKeyboard();
  return (
    <>
      {children}
      <CommandPalette />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AuthIntegration>
        <ToastProvider>
          <BrowserRouter>
            <CommandPaletteProvider>
              {/* Analytics wiring */}
              <AnalyticsRouterListener />
              <PostHogClerkBridge />
              <AppLayout>
                <ProtectedRoute>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                      </div>
                    }
                  >
                    <Routes>
                      <Route path="/" element={<WorkflowList />} />
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
                      <Route path="/secrets" element={<SecretsManager />} />
                      <Route path="/api-keys" element={<ApiKeysManager />} />
                      <Route path="/integrations" element={<IntegrationsManager />} />
                      <Route path="/webhooks" element={<WebhooksPage />} />
                      <Route path="/webhooks/new" element={<WebhookEditorPage />} />
                      <Route path="/webhooks/:id" element={<WebhookEditorPage />} />
                      <Route path="/webhooks/:id/deliveries" element={<WebhookEditorPage />} />
                      <Route path="/webhooks/:id/settings" element={<WebhookEditorPage />} />
                      <Route path="/schedules" element={<SchedulesPage />} />
                      <Route path="/action-center" element={<ActionCenterPage />} />
                      <Route path="/analytics-settings" element={<AnalyticsSettingsPage />} />
                      <Route path="/artifacts" element={<ArtifactLibrary />} />
                      <Route path="/mcp-library" element={<McpLibraryPage />} />
                      <Route path="/runs/:runId" element={<RunRedirect />} />
                      <Route
                        path="/integrations/callback/:provider"
                        element={<IntegrationCallback />}
                      />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </ProtectedRoute>
              </AppLayout>
            </CommandPaletteProvider>
          </BrowserRouter>
        </ToastProvider>
      </AuthIntegration>
    </AuthProvider>
  );
}

export default App;
