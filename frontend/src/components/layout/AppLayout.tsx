import { ThemeTransition } from '@/components/ui/ThemeTransition'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarItem } from '@/components/ui/sidebar'
import { AppTopBar } from '@/components/layout/AppTopBar'
import { Button } from '@/components/ui/button'
import { Workflow, KeyRound, Plus, Plug, Archive, CalendarClock, Sun, Moon, Shield } from 'lucide-react'
import React, { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { UserButton } from '@/components/auth/UserButton'
import { useAuth, useAuthProvider } from '@/auth/auth-context'
import { env } from '@/config/env'
import { useThemeStore } from '@/store/themeStore'
import { cn } from '@/lib/utils'
import { setMobilePlacementSidebarClose } from '@/components/layout/Sidebar'

interface AppLayoutProps {
  children: React.ReactNode
}

interface SidebarContextValue {
  isOpen: boolean
  isMobile: boolean
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


// Custom hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isMobile
}

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  const [, setIsHovered] = useState(false)
  const [wasExplicitlyOpened, setWasExplicitlyOpened] = useState(!isMobile)
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
  // If it's a tag (starts with v), show full tag. Otherwise show first 7 chars of SHA
  const displayVersion = gitSha && gitSha !== '' && gitSha !== 'unknown'
    ? (gitSha.startsWith('v') ? gitSha : gitSha.slice(0, 7))
    : 'dev'

  // Auto-collapse sidebar when opening workflow builder, expand for other routes
  // On mobile, always start collapsed
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
      setWasExplicitlyOpened(false)
    } else {
      const isWorkflowRoute = location.pathname.startsWith('/workflows') && location.pathname !== '/'
      setSidebarOpen(!isWorkflowRoute)
      setWasExplicitlyOpened(!isWorkflowRoute)
    }
  }, [location.pathname, isMobile])

  // Close sidebar on mobile when navigating
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }, [location.pathname, isMobile])

  // Set up sidebar close callback for mobile component placement
  useEffect(() => {
    if (isMobile) {
      setMobilePlacementSidebarClose(() => {
        setSidebarOpen(false)
        setWasExplicitlyOpened(false)
      })
    }
    return () => {
      setMobilePlacementSidebarClose(() => { })
    }
  }, [isMobile])

  // Handle hover to expand sidebar when collapsed (desktop only)
  const handleMouseEnter = () => {
    if (isMobile) return
    setIsHovered(true)
    if (!sidebarOpen) {
      setSidebarOpen(true)
    }
  }

  const handleMouseLeave = () => {
    if (isMobile) return
    setIsHovered(false)
    // Only collapse if it was expanded due to hover (not explicitly opened)
    if (!wasExplicitlyOpened && sidebarOpen) {
      setSidebarOpen(false)
    }
  }

  const handleToggle = useCallback(() => {
    const newState = !sidebarOpen
    setSidebarOpen(newState)
    setWasExplicitlyOpened(newState)
  }, [sidebarOpen])

  // --- Swipe Gesture Logic for Mobile ---
  const [touchStart, setTouchStart] = useState<number | null>(null)

  useEffect(() => {
    if (!isMobile) return

    const handleTouchStart = (e: TouchEvent) => {
      const x = e.touches[0].clientX
      // Start tracking if touching near the left edge to open
      if (!sidebarOpen && x < 30) {
        setTouchStart(x)
      }
      // Or if sidebar is already open, track anywhere to detect closing swipe
      else if (sidebarOpen) {
        setTouchStart(x)
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStart === null) return

      const currentX = e.touches[0].clientX
      const diff = currentX - touchStart

      // Prevent default scrolling if we are clearly swiping the sidebar
      if (Math.abs(diff) > 10) {
        // If sidebar is closed and we're swiping right (opening)
        if (!sidebarOpen && diff > 0) {
          // e.preventDefault() // This might trigger passive warning if not careful
        }
        // If sidebar is open and we're swiping left (closing)
        if (sidebarOpen && diff < 0) {
          // e.preventDefault()
        }
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStart === null) return

      const endX = e.changedTouches[0].clientX
      const diff = endX - touchStart
      const threshold = 50 // px to trigger toggle

      // Swipe right to open
      if (!sidebarOpen && diff > threshold && touchStart < 30) {
        setSidebarOpen(true)
        setWasExplicitlyOpened(true)
      }
      // Swipe left to close
      else if (sidebarOpen && diff < -threshold) {
        setSidebarOpen(false)
        setWasExplicitlyOpened(false)
      }

      setTouchStart(null)
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isMobile, sidebarOpen, touchStart])

  // Close sidebar when clicking backdrop on mobile
  const handleBackdropClick = useCallback(() => {
    if (isMobile && sidebarOpen) {
      setSidebarOpen(false)
      setWasExplicitlyOpened(false)
    }
  }, [isMobile, sidebarOpen])

  const sidebarContextValue: SidebarContextValue = {
    isOpen: sidebarOpen,
    isMobile,
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
    ...(env.VITE_ENABLE_CONNECTIONS ? [{
      name: 'Connections',
      href: '/integrations',
      icon: Plug,
    }] : []),
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
          size={isMobile ? "sm" : "default"}
          className={cn("gap-2", isMobile && "h-8 px-3 text-xs")}
          disabled={!canManageWorkflows}
          aria-disabled={!canManageWorkflows}
        >
          <Plus className={cn("w-4 h-4", isMobile && "w-3.5 h-3.5")} />
          <span>New <span className="hidden md:inline">Workflow</span></span>
        </Button>
      )
    }

    return null
  }

  return (
    <SidebarContext.Provider value={sidebarContextValue}>
      <ThemeTransition />
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Mobile backdrop overlay */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm transition-opacity duration-300"
            onClick={handleBackdropClick}
            aria-hidden="true"
          />
        )}

        {/* Sidebar */}
        <Sidebar
          className={cn(
            'h-full transition-all duration-300 z-[110]',
            // Mobile: Fixed position, slide in/out
            isMobile ? 'fixed left-0 top-0' : 'relative',
            // Width based on state and device
            sidebarOpen ? 'w-72' : isMobile ? 'w-0 -translate-x-full' : 'w-16',
            // Ensure sidebar is above backdrop on mobile
            isMobile && sidebarOpen && 'translate-x-0'
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Sidebar Header - same style for mobile and desktop */}
          <SidebarHeader className="flex items-center justify-between p-4 border-b">
            <Link to="/" className="flex items-center gap-2" onClick={() => isMobile && setSidebarOpen(false)}>
              <div className="flex-shrink-0">
                <img
                  src="/favicon.ico"
                  alt="ShipSec Studio"
                  className="w-6 h-6"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                    e.currentTarget.nextElementSibling?.classList.remove('hidden')
                  }}
                />
                <span className="hidden text-sm font-bold">SS</span>
              </div>
              <span
                className={cn(
                  'font-bold text-xl transition-all duration-300 whitespace-nowrap overflow-hidden',
                  sidebarOpen ? 'opacity-100 max-w-48' : 'opacity-0 max-w-0'
                )}
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
            <div className={cn(
              'px-2 mt-2 space-y-1'
            )}>
              {navigationItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => {
                      // Close sidebar on mobile after navigation
                      if (isMobile) {
                        setSidebarOpen(false)
                        return
                      }
                      // Keep sidebar open when navigating to non-workflow routes (desktop)
                      if (!item.href.startsWith('/workflows')) {
                        setSidebarOpen(true)
                        setWasExplicitlyOpened(true)
                      }
                    }}
                  >
                    <SidebarItem
                      isActive={active}
                      className={cn(
                        'flex items-center gap-3',
                        sidebarOpen ? 'justify-start px-4' : 'justify-center'
                      )}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      <span
                        className={cn(
                          'transition-all duration-300 whitespace-nowrap overflow-hidden flex-1',
                          sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0'
                        )}
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
                className={cn(
                  'text-xs text-muted-foreground transition-all duration-300 whitespace-nowrap overflow-hidden block text-center',
                  sidebarOpen ? 'opacity-100 max-w-full' : 'opacity-0 max-w-0'
                )}
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
        <main className={cn(
          'flex-1 flex flex-col overflow-hidden min-w-0',
          // On mobile, main content takes full width since sidebar is overlay
          isMobile ? 'w-full' : ''
        )}>
          {/* Only show AppTopBar for non-workflow-builder pages */}
          {!location.pathname.startsWith('/workflows') && (
            <AppTopBar
              sidebarOpen={sidebarOpen}
              onSidebarToggle={handleToggle}
              actions={getPageActions()}
              isMobile={isMobile}
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
