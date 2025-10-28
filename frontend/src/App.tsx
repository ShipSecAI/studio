import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkflowList } from '@/pages/WorkflowList'
import { WorkflowBuilder } from '@/pages/WorkflowBuilder'
import { SecretsManager } from '@/pages/SecretsManager'
import { IntegrationsManager } from '@/pages/IntegrationsManager'
import { IntegrationCallback } from '@/pages/IntegrationCallback'
import { ToastProvider } from '@/components/ui/toast-provider'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuthProvider } from '@/auth/auth-context'
import { useAuthStoreIntegration } from '@/auth/store-integration'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

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
                    path="/secrets"
                    element={
                      <ProtectedRoute roles={['ADMIN']}>
                        <SecretsManager />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/integrations" element={<IntegrationsManager />} />
                  <Route
                    path="/integrations/callback/:provider"
                    element={<IntegrationCallback />}
                  />
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
