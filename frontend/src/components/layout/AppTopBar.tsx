import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

interface AppTopBarProps {
  title?: string
  subtitle?: string
  showSidebarToggle?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  actions?: React.ReactNode
}

export function AppTopBar({
  title,
  subtitle,
  showSidebarToggle = true,
  sidebarOpen,
  onSidebarToggle,
  actions
}: AppTopBarProps) {
  const location = useLocation()

  // Determine page title and navigation based on current route
  const getPageInfo = () => {
    if (title) return { title, subtitle }

    if (location.pathname === '/') {
      return {
        title: 'Security Workflow Builder',
        subtitle: 'Create and manage security automation workflows'
      }
    }

    if (location.pathname.startsWith('/workflows')) {
      return {
        title: 'Workflow Builder',
        subtitle: 'Design and automate security workflows'
      }
    }

    if (location.pathname === '/secrets') {
      return {
        title: 'Secret Manager',
        subtitle: 'Store and manage sensitive credentials'
      }
    }

    return {
      title: 'Security Workflow Builder',
      subtitle: 'Create and manage security automation workflows'
    }
  }

  const pageInfo = getPageInfo()

  return (
    <div className="h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center px-4 gap-4 sticky top-0 z-30">
      {/* Sidebar toggle */}
      {showSidebarToggle && onSidebarToggle && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onSidebarToggle}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          className="hidden md:flex"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
        </Button>
      )}

      {/* Mobile menu */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onSidebarToggle}
        aria-label="Toggle navigation"
      >
        {sidebarOpen ? (
          <PanelLeftClose className="h-5 w-5" />
        ) : (
          <PanelLeftOpen className="h-5 w-5" />
        )}
      </Button>

      {/* Page title section */}
      <div className="flex items-center">
        <h1 className="text-xl font-semibold">{pageInfo.title}</h1>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {actions}
      </div>
    </div>
  )
}
