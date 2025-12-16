import { ThemeTransition } from '@/components/ui/ThemeTransition'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarItem } from '@/components/ui/sidebar'
import { AppTopBar } from '@/components/layout/AppTopBar'
import { Button } from '@/components/ui/button'
import { Workflow, KeyRound, Plus, Plug, Archive, CalendarClock, Sun, Moon, Shield } from 'lucide-react'
import React, { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { UserButton } from '@/components/auth/UserButton'
import { useAuth, useAuthProvider } from '@/auth/auth-context'
import { env } from '@/config/env'
import { useThemeStore } from '@/store/themeStore'

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
  const [, setIsHovered] = useState(false)
  const [wasExplicitlyOpened, setWasExplicitlyOpened] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()
  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const { isAuthenticated } = useAuth()
  const authProvider = useAuthProvider()
  const showUserButton = isAuthenticated || authProvider.name === 'clerk'
  const { theme, startTransition } = useThemeStore()

  // Get git SHA for version display (monorepo - same for frontend and backend)
  const gitSha = env.VITE_GIT_SHA
  const displayVersion = gitSha && gitSha !== '' ? gitSha.slice(0, 6) : 'dev'

  // Auto-collapse sidebar when opening workflow builder, expand for other routes
  useEffect(() => {
    const isWorkflowRoute = location.pathname.startsWith('/workflows') && location.pathname !== '/'
    setSidebarOpen(!isWorkflowRoute)
    setWasExplicitlyOpened(!isWorkflowRoute)
  }, [location.pathname])

  // Handle hover to expand sidebar when collapsed
  const handleMouseEnter = () => {
    setIsHovered(true)
    if (!sidebarOpen) {
      setSidebarOpen(true)
    }
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    // Only collapse if it was expanded due to hover (not explicitly opened)
    if (!wasExplicitlyOpened && sidebarOpen) {
      setSidebarOpen(false)
    }
  }

  const handleToggle = () => {
    const newState = !sidebarOpen
    setSidebarOpen(newState)
    setWasExplicitlyOpened(newState)
  }

  const sidebarContextValue: SidebarContextValue = {
    isOpen: sidebarOpen,
    toggle: handleToggle
  }

  const navigationItems = [
    {
      name: 'Workflow Builder',
      href: '/',
      icon: Workflow,
    },
    {
      name: 'Schedules',
      href: '/schedules',
      icon: CalendarClock,
    },
    {
      name: 'Secrets',
      href: '/secrets',
      icon: KeyRound,
    },
    {
      name: 'API Keys',
      href: '/api-keys',
      icon: Shield,
    },
    {
      name: 'Connections',
      href: '/integrations',
      icon: Plug,
    },
    {
      name: 'Artifact Library',
      href: '/artifacts',
      icon: Archive,
    },
  ]

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/workflows')
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
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
      <ThemeTransition />
      <div className="flex h-screen bg-background">
        {/* Sidebar */}
        <Sidebar
          className={`fixed md:relative z-40 h-full transition-all duration-300 ${sidebarOpen ? 'w-64' : 'w-0 md:w-16'
            }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <SidebarHeader className="flex items-center justify-between p-4 border-b">
            <Link to="/" className="flex items-center gap-2">
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
                className={`font-bold text-xl transition-all duration-300 whitespace-nowrap overflow-hidden ${sidebarOpen
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
            </Link>
          </SidebarHeader>

          <SidebarContent className="py-0">
            <div className="space-y-1 px-2 mt-2">
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
                        setWasExplicitlyOpened(true)
                      }
                    }}
                  >
                    <SidebarItem
                      isActive={active}
                      className="flex items-center gap-3 justify-center md:justify-start"
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      <span
                        className={`transition-all duration-300 whitespace-nowrap overflow-hidden ${sidebarOpen
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

          <SidebarFooter className="border-t p-0">
            <div className="flex flex-col gap-1.5 p-1">
              {/* Auth components - UserButton includes organization switching */}
              {showUserButton && (
                <div className={`flex items-center gap-2 ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
                  <UserButton
                    className={sidebarOpen ? 'flex-1' : 'w-auto'}
                    sidebarCollapsed={!sidebarOpen}
                  />
                  {/* Dark mode toggle */}
                  {sidebarOpen && (
                    <button
                      onClick={startTransition}
                      className="p-2 rounded-lg transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground flex-shrink-0"
                      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                      {theme === 'dark' ? (
                        <Sun className="h-5 w-5 text-amber-500" />
                      ) : (
                        <Moon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                      )}
                    </button>
                  )}
                </div>
              )}
              {/* Dark mode toggle when no user button */}
              {!showUserButton && (
                <div className={`flex ${sidebarOpen ? 'justify-end' : 'justify-center'}`}>
                  <button
                    onClick={startTransition}
                    className="p-2 rounded-lg transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    {theme === 'dark' ? (
                      <Sun className="h-5 w-5 text-amber-500" />
                    ) : (
                      <Moon className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </SidebarFooter>

          {/* Version info - its own dedicated section at absolute bottom with animation */}
          <div className="px-2 py-1.5 border-t">
            <div className="h-4 flex items-center justify-center">
              <span
                className={`text-xs text-muted-foreground transition-all duration-300 whitespace-nowrap overflow-hidden block text-center ${sidebarOpen
                  ? 'opacity-100 max-w-full'
                  : 'opacity-0 max-w-0'
                  }`}
                style={{
                  transitionDelay: sidebarOpen ? '200ms' : '0ms',
                  transitionProperty: 'opacity, max-width'
                }}
              >
                version: {displayVersion}
              </span>
            </div>
          </div>
        </Sidebar>

        {/* Main content area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Only show AppTopBar for non-workflow-builder pages */}
          {!location.pathname.startsWith('/workflows') && (
            <AppTopBar
              sidebarOpen={sidebarOpen}
              onSidebarToggle={handleToggle}
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
