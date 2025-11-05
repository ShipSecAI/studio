import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WorkflowList } from '@/pages/WorkflowList'
import { WorkflowBuilder } from '@/pages/WorkflowBuilder'
import { SecretsManager } from '@/pages/SecretsManager'
import { ToastProvider } from '@/components/ui/toast-provider'
import { AppLayout } from '@/components/layout/AppLayout'

// New auth system imports
import { AuthProvider } from '@/auth/auth-context'
import { useAuthStoreIntegration } from '@/auth/store-integration'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AnalyticsRouterListener } from '@/features/analytics/AnalyticsRouterListener'
import { PostHogClerkBridge } from '@/features/analytics/PostHogClerkBridge'

// Auth integration component
function AuthIntegration({ children }: { children: React.ReactNode }) {
  useAuthStoreIntegration();
  return <>{children}</>;
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
                    path="/secrets"
                    element={
                      <ProtectedRoute roles={['ADMIN']}>
                        <SecretsManager />
                      </ProtectedRoute>
                    }
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
