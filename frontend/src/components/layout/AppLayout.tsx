import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarItem } from '@/components/ui/sidebar'
import { AppTopBar } from '@/components/layout/AppTopBar'
import { Button } from '@/components/ui/button'
import { Workflow, KeyRound, Plus, Plug } from 'lucide-react'
import React, { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { UserButton } from '@/components/auth/UserButton'
import { AuthSettingsButton } from '@/components/auth/AuthSettingsButton'
import { useAuth, useAuthProvider } from '@/auth/auth-context'

interface AppLayoutProps {
  children: React.ReactNode
}

interface SidebarContextValue {
  isOpen: boolean
  toggle: () => void
}

export const SidebarContext = React.createContext<SidebarContextValue | undefined>(undefined)

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (context === undefined) {
    throw new Error('useSidebar must be used within an AppLayout')
  }
  return context
}

export function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()
  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const { isAuthenticated } = useAuth()
  const authProvider = useAuthProvider()
  const showUserButton = isAuthenticated || authProvider.name === 'clerk'

  // Auto-collapse sidebar when opening workflow builder, expand for other routes
  useEffect(() => {
    const isWorkflowRoute = location.pathname.startsWith('/workflows') && location.pathname !== '/'
    setSidebarOpen(!isWorkflowRoute)
  }, [location.pathname])

  const sidebarContextValue: SidebarContextValue = {
    isOpen: sidebarOpen,
    toggle: () => setSidebarOpen(!sidebarOpen)
  }

  const navigationItems = [
    {
      name: 'Workflow Builder',
      href: '/',
      icon: Workflow,
    },
    {
      name: 'Secrets',
      href: '/secrets',
      icon: KeyRound,
    },
    {
      name: 'Connections',
      href: '/integrations',
      icon: Plug,
    },
  ]

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/workflows')
    }
    return location.pathname === path
  }

  // Get page-specific actions
  const getPageActions = () => {
    if (location.pathname === '/') {
      return (
        <Button
          onClick={() => {
            if (!canManageWorkflows) return
            navigate('/workflows/new')
          }}
          className="gap-2"
          disabled={!canManageWorkflows}
          aria-disabled={!canManageWorkflows}
        >
          <Plus className="h-4 w-4" />
          New Workflow
        </Button>
      )
    }

    return null
  }

  return (
    <SidebarContext.Provider value={sidebarContextValue}>
      <div className="flex h-screen bg-background">
        {/* Sidebar */}
        <Sidebar
          className={`fixed md:relative z-40 h-full transition-all duration-300 ${
            sidebarOpen ? 'w-64' : 'w-0 md:w-16'
          }`}
        >
        <SidebarHeader className="flex items-center gap-3 p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0">
              <img
                src="/favicon.ico"
                alt="ShipSec Studio"
                className="w-6 h-6"
                onError={(e) => {
                  // Fallback to text if image fails to load
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextElementSibling?.classList.remove('hidden')
                }}
              />
              <span className="hidden text-sm font-bold">SS</span>
            </div>
            <span
              className={`font-bold text-xl transition-all duration-300 whitespace-nowrap overflow-hidden ${
                sidebarOpen
                  ? 'opacity-100 max-w-48'
                  : 'opacity-0 max-w-0'
              }`}
              style={{
                transitionDelay: sidebarOpen ? '150ms' : '0ms',
                transitionProperty: 'opacity, max-width'
              }}
            >
              ShipSec Studio
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <div className="space-y-1 px-2 mt-4">
            {navigationItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => {
                    // Keep sidebar open when navigating to non-workflow routes
                    if (!item.href.startsWith('/workflows')) {
                      setSidebarOpen(true)
                    }
                  }}
                >
                  <SidebarItem
                    isActive={active}
                    className="flex items-center gap-3 justify-center md:justify-start"
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span
                      className={`transition-all duration-300 whitespace-nowrap overflow-hidden ${
                        sidebarOpen
                          ? 'opacity-100 max-w-32'
                          : 'opacity-0 max-w-0'
                      }`}
                      style={{
                        transitionDelay: sidebarOpen ? '200ms' : '0ms',
                        transitionProperty: 'opacity, max-width'
                      }}
                    >
                      {item.name}
                    </span>
                  </SidebarItem>
                </Link>
              )
            })}
          </div>
        </SidebarContent>

        <SidebarFooter className="border-t">
          <div className="flex flex-col gap-2 p-2">
            {/* Auth components - UserButton includes organization switching */}
            {showUserButton ? (
              <div className={`flex ${sidebarOpen ? 'justify-start' : 'justify-center'}`}>
                <UserButton 
                  className={sidebarOpen ? 'w-full' : 'w-auto'}
                  sidebarCollapsed={!sidebarOpen}
                />
              </div>
            ) : (
              <div className={`flex ${sidebarOpen ? 'justify-start' : 'justify-center'}`}>
                <AuthSettingsButton />
              </div>
            )}
            
            {/* Version info */}
            <div className={`text-xs text-muted-foreground pt-2 border-t px-2 text-center transition-all duration-300 ${
              sidebarOpen ? 'opacity-100' : 'opacity-0'
            }`}>
              ShipSec Studio v1.0
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* Main content area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Only show AppTopBar for non-workflow-builder pages */}
        {!location.pathname.startsWith('/workflows') && (
          <AppTopBar
            sidebarOpen={sidebarOpen}
            onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
            actions={getPageActions()}
          />
        )}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
    </SidebarContext.Provider>
  )
}
