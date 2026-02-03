import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WorkflowList } from '@/pages/WorkflowList';
import { WorkflowBuilder } from '@/features/workflow-builder/WorkflowBuilder';
import { SecretsManager } from '@/pages/SecretsManager';
import { ApiKeysManager } from '@/pages/ApiKeysManager';
import { IntegrationsManager } from '@/pages/IntegrationsManager';
import { ArtifactLibrary } from '@/pages/ArtifactLibrary';
import { IntegrationCallback } from '@/pages/IntegrationCallback';
import { NotFound } from '@/pages/NotFound';
import { WebhooksPage } from '@/pages/WebhooksPage';
import { WebhookEditorPage } from '@/pages/WebhookEditorPage';
import { SchedulesPage } from '@/pages/SchedulesPage';
import { ActionCenterPage } from '@/pages/ActionCenterPage';
import { RunRedirect } from '@/pages/RunRedirect';
import { AgentPage } from '@/pages/AgentPage';
import { ToastProvider } from '@/components/ui/toast-provider';
import { AppLayout } from '@/components/layout/AppLayout';
import { AgentLayout } from '@/components/layout/AgentLayout';
import { AuthProvider } from '@/auth/auth-context';
import { useAuthStoreIntegration } from '@/auth/store-integration';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AnalyticsRouterListener } from '@/features/analytics/AnalyticsRouterListener';
import { PostHogClerkBridge } from '@/features/analytics/PostHogClerkBridge';
import { CommandPalette, useCommandPaletteKeyboard } from '@/features/command-palette';

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
              <Routes>
                {/* Agent Page - New home page with its own layout */}
                <Route
                  path="/"
                  element={
                    <AgentLayout>
                      <AgentPage />
                    </AgentLayout>
                  }
                />

                {/* Studio routes with AppLayout */}
                <Route
                  path="/studio/*"
                  element={
                    <AppLayout>
                      <ProtectedRoute>
                        <Routes>
                          <Route path="/" element={<WorkflowList />} />
                          <Route path="/workflows/:id" element={<WorkflowBuilder />} />
                          <Route path="/workflows/:id/runs" element={<WorkflowBuilder />} />
                          <Route path="/workflows/:id/runs/:runId" element={<WorkflowBuilder />} />
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
                          <Route path="/artifacts" element={<ArtifactLibrary />} />
                          <Route path="/runs/:runId" element={<RunRedirect />} />
                          <Route
                            path="/integrations/callback/:provider"
                            element={<IntegrationCallback />}
                          />
                        </Routes>
                      </ProtectedRoute>
                    </AppLayout>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </CommandPaletteProvider>
          </BrowserRouter>
        </ToastProvider>
      </AuthIntegration>
    </AuthProvider>
  );
}

export default App;
