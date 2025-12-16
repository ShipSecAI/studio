import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkflowList } from '@/pages/WorkflowList'
import { WorkflowBuilder } from '@/pages/WorkflowBuilder'
import { SecretsManager } from '@/pages/SecretsManager'
import { ApiKeysManager } from '@/pages/ApiKeysManager'
import { IntegrationsManager } from '@/pages/IntegrationsManager'
import { ArtifactLibrary } from '@/pages/ArtifactLibrary'
import { IntegrationCallback } from '@/pages/IntegrationCallback'
import { NotFound } from '@/pages/NotFound'
import { SchedulesPage } from '@/pages/SchedulesPage'
import { ToastProvider } from '@/components/ui/toast-provider'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthProvider } from '@/auth/auth-context'
import { useAuthStoreIntegration } from '@/auth/store-integration'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AnalyticsRouterListener } from '@/features/analytics/AnalyticsRouterListener'
import { PostHogClerkBridge } from '@/features/analytics/PostHogClerkBridge'

function AuthIntegration({ children }: { children: React.ReactNode }) {
  useAuthStoreIntegration()
  return <>{children}</>
}

function App() {
  return (
    <AuthProvider>
      <AuthIntegration>
        <ToastProvider>
          <BrowserRouter>
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
                  <Route path="/artifacts" element={<ArtifactLibrary />} />
                  <Route
                    path="/integrations/callback/:provider"
                    element={<IntegrationCallback />}
                  />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </ProtectedRoute>
            </AppLayout>
          </BrowserRouter>
        </ToastProvider>
      </AuthIntegration>
    </AuthProvider>
  )
}

export default App
