import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkflowList } from '@/pages/WorkflowList'
import { WorkflowBuilder } from '@/features/workflow-builder/WorkflowBuilder'
import { SecretsManager } from '@/pages/SecretsManager'
import { ApiKeysManager } from '@/pages/ApiKeysManager'
import { IntegrationsManager } from '@/pages/IntegrationsManager'
import { ArtifactLibrary } from '@/pages/ArtifactLibrary'
import { IntegrationCallback } from '@/pages/IntegrationCallback'
import { NotFound } from '@/pages/NotFound'
import { SchedulesPage } from '@/pages/SchedulesPage'
import { ActionCenterPage } from '@/pages/ActionCenterPage'
import { RunRedirect } from '@/pages/RunRedirect'
import { ToastProvider } from '@/components/ui/toast-provider'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthProvider } from '@/auth/auth-context'
import { useAuthStoreIntegration } from '@/auth/store-integration'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AnalyticsRouterListener } from '@/features/analytics/AnalyticsRouterListener'
import { PostHogClerkBridge } from '@/features/analytics/PostHogClerkBridge'
import { CommandPalette, useCommandPaletteKeyboard } from '@/features/command-palette'

function AuthIntegration({ children }: { children: React.ReactNode }) {
  useAuthStoreIntegration()
  return <>{children}</>
}

function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  useCommandPaletteKeyboard()
  return (
    <>
      {children}
      <CommandPalette />
    </>
  )
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
                    <Route path="/schedules" element={<SchedulesPage />} />
                    <Route path="/action-center" element={<ActionCenterPage />} />
                    <Route path="/artifacts" element={<ArtifactLibrary />} />
                    <Route path="/runs/:runId" element={<RunRedirect />} />
                    <Route
                      path="/integrations/callback/:provider"
                      element={<IntegrationCallback />}
                    />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </ProtectedRoute>
              </AppLayout>
            </CommandPaletteProvider>
          </BrowserRouter>
        </ToastProvider>
      </AuthIntegration>
    </AuthProvider>
  )
}

export default App
