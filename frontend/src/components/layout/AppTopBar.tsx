import { useLocation, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { env } from '@/config/env'
import { cn } from '@/lib/utils'

interface AppTopBarProps {
  title?: string
  subtitle?: string
  showSidebarToggle?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  actions?: React.ReactNode
  isMobile?: boolean
}

export function AppTopBar({
  title,
  subtitle,
  showSidebarToggle = true,
  sidebarOpen,
  onSidebarToggle,
  actions,
  isMobile = false
}: AppTopBarProps) {
  const location = useLocation()

  // Determine page title and navigation based on current route
  const getPageInfo = () => {
    if (title) return { title, subtitle }

    if (location.pathname === '/') {
      return {
        title: 'Security Workflow Builder',
        shortTitle: 'Workflows',
        subtitle: 'Create and manage security automation workflows'
      }
    }

    if (location.pathname.startsWith('/workflows')) {
      return {
        title: 'Workflow Builder',
        shortTitle: 'Builder',
        subtitle: 'Design and automate security workflows'
      }
    }

    if (location.pathname.startsWith('/schedules')) {
      return {
        title: 'Workflow Schedules',
        shortTitle: 'Schedules',
        subtitle: 'Manage recurring workflow cadences'
      }
    }

    if (location.pathname === '/secrets') {
      return {
        title: 'Secret Manager',
        shortTitle: 'Secrets',
        subtitle: 'Store and manage sensitive credentials'
      }
    }

    if (location.pathname === '/api-keys') {
      return {
        title: 'API Keys',
        shortTitle: 'API Keys',
        subtitle: 'Manage API keys for workflow triggers'
      }
    }

    if (env.VITE_ENABLE_CONNECTIONS && location.pathname === '/integrations') {
      return {
        title: 'Connections',
        shortTitle: 'Connections',
        subtitle: 'Manage OAuth tokens for external providers'
      }
    }

    if (location.pathname === '/artifacts') {
      return {
        title: 'Artifact Library',
        shortTitle: 'Artifacts',
        subtitle: 'Browse artifacts saved across workflow runs'
      }
    }

    return {
      title: 'Security Workflow Builder',
      shortTitle: 'Workflows',
      subtitle: 'Create and manage security automation workflows'
    }
  }

  const pageInfo = getPageInfo()

  return (
    <div className={cn(
      'h-[56px] md:h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
      'flex items-center px-3 md:px-4 gap-2 md:gap-4 sticky top-0 z-40'
    )}>
      {/* Sidebar toggle - works on both mobile and desktop */}
      {showSidebarToggle && onSidebarToggle && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onSidebarToggle}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          className="h-9 w-9 flex-shrink-0"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
        </Button>
      )}

      {/* Logo and Page title section */}
      <div className="flex items-center min-w-0 flex-1 gap-3">
        {/* Mobile: ShipSec Studio stacked | Page Title (except on workflows page) */}
        {isMobile ? (
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/" className="flex items-center gap-1.5 flex-shrink-0">
              <img
                src="/favicon.ico"
                alt="ShipSec"
                className="w-6 h-6"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              <div className="flex flex-col leading-none">
                <span className="font-bold text-base">ShipSec</span>
                <span className="text-xs text-muted-foreground font-medium -mt-1.5">Studio</span>
              </div>
            </Link>
            {/* Show page title on non-workflow pages */}
            {location.pathname !== '/' && !location.pathname.startsWith('/workflows') && (
              <>
                <span className="text-muted-foreground">|</span>
                <span className="font-medium text-sm truncate">{pageInfo.shortTitle || pageInfo.title}</span>
              </>
            )}
          </div>
        ) : (
          /* Desktop: Full page title */
          <h1 className="text-xl font-semibold truncate">
            {pageInfo.title}
          </h1>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {actions}
      </div>
    </div>
  )
}
