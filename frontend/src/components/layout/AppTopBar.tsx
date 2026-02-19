import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppTopBarProps {
  title?: string;
  subtitle?: string;
  showSidebarToggle?: boolean;
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
  actions?: React.ReactNode;
  afterTitle?: React.ReactNode;
  isMobile?: boolean;
}

export function AppTopBar({
  title,
  subtitle,
  showSidebarToggle = true,
  sidebarOpen,
  onSidebarToggle,
  actions,
  afterTitle,
  isMobile = false,
}: AppTopBarProps) {
  const location = useLocation();

  // Determine page title and navigation based on current route
  const getPageInfo = () => {
    if (title) return { title, subtitle };

    if (location.pathname === '/') {
      return {
        title: 'Home',
        shortTitle: 'Home',
        subtitle: 'Security posture overview and onboarding',
      };
    }

    if (location.pathname === '/builder') {
      return {
        title: 'Workflow Builder',
        shortTitle: 'Builder',
        subtitle: 'Create and manage security automation workflows',
      };
    }

    if (location.pathname.startsWith('/workflows')) {
      return {
        title: 'Workflow Builder',
        shortTitle: 'Builder',
        subtitle: 'Design and automate security workflows',
      };
    }

    if (location.pathname.startsWith('/schedules')) {
      return {
        title: 'Workflow Schedules',
        shortTitle: 'Schedules',
        subtitle: 'Manage recurring workflow cadences',
      };
    }

    if (location.pathname === '/secrets') {
      return {
        title: 'Secret Manager',
        shortTitle: 'Secrets',
        subtitle: 'Store and manage sensitive credentials',
      };
    }

    if (location.pathname === '/webhooks') {
      return {
        title: 'Webhooks Manager',
        shortTitle: 'Webhooks',
        subtitle: 'Manage and debug incoming webhooks',
      };
    }

    if (location.pathname === '/api-keys') {
      return {
        title: 'API Keys',
        shortTitle: 'API Keys',
        subtitle: 'Manage API keys for workflow triggers',
      };
    }

    if (location.pathname === '/integrations' || location.pathname.startsWith('/integrations/')) {
      return {
        title: 'Integrations',
        shortTitle: 'Integrations',
        subtitle:
          'Connect external services to enable cloud security scanning, notifications, and more',
      };
    }

    if (location.pathname === '/artifacts') {
      return {
        title: 'Artifact Library',
        shortTitle: 'Artifacts',
        subtitle: 'Browse artifacts saved across workflow runs',
      };
    }

    if (location.pathname === '/templates') {
      return {
        title: 'Workflow Templates',
        shortTitle: 'Templates',
        subtitle: 'Browse and use pre-built workflow templates',
      };
    }

    if (location.pathname === '/recon') {
      return {
        title: 'Attack Surface Recon',
        shortTitle: 'Recon',
        subtitle: 'Discover subdomains, open ports, and vulnerabilities',
      };
    }

    if (location.pathname === '/mcp-library') {
      return {
        title: 'MCP Servers',
        shortTitle: 'MCP Servers',
        subtitle: 'Manage Model Context Protocol server integrations',
      };
    }

    if (location.pathname === '/analytics-settings') {
      return {
        title: 'Analytics Settings',
        shortTitle: 'Analytics',
        subtitle: 'Configure analytics and reporting preferences',
      };
    }

    if (location.pathname === '/action-center') {
      return {
        title: 'Action Center',
        shortTitle: 'Actions',
        subtitle: 'Review and manage pending actions',
      };
    }

    if (location.pathname.startsWith('/security')) {
      return {
        title: 'Cloud Findings',
        shortTitle: 'Cloud Findings',
        subtitle: 'Unified security findings across all scanners',
      };
    }

    if (location.pathname.startsWith('/github')) {
      return {
        title: 'GitHub',
        shortTitle: 'GitHub',
        subtitle: 'Manage repositories, trigger rules, and scan results',
      };
    }

    if (location.pathname.startsWith('/cloud/accounts')) {
      return {
        title: 'Cloud Accounts',
        shortTitle: 'Cloud',
        subtitle: 'Manage your AWS accounts and run cloud security scans',
      };
    }

    return {
      title: 'Home',
      shortTitle: 'Home',
      subtitle: 'Security posture overview and onboarding',
    };
  };

  const pageInfo = getPageInfo() as {
    title: string;
    shortTitle?: string;
    subtitle?: string;
    breadcrumb?: { label: string; href: string };
  };

  return (
    <div
      className={cn(
        'h-[56px] md:h-[60px] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        'flex items-center px-3 md:px-4 gap-2 md:gap-4 sticky top-0 z-40',
      )}
    >
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
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="flex flex-col leading-none">
                <span className="font-bold text-base">ShipSec</span>
                <span className="text-xs text-muted-foreground font-medium -mt-1.5">Studio</span>
              </div>
            </Link>
            {/* Show page title on non-workflow-builder pages */}
            {!location.pathname.startsWith('/workflows') && (
              <>
                <span className="text-muted-foreground">|</span>
                <span className="font-medium text-sm truncate">
                  {pageInfo.shortTitle || pageInfo.title}
                </span>
              </>
            )}
          </div>
        ) : (
          /* Desktop: Full page title with optional clickable breadcrumb */
          <h1 className={cn('text-xl font-semibold', afterTitle ? 'flex-shrink-0' : 'truncate')}>
            {pageInfo.breadcrumb ? (
              <>
                <Link
                  to={pageInfo.breadcrumb.href}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {pageInfo.breadcrumb.label}
                </Link>
                <span className="text-muted-foreground mx-1">/</span>
                {pageInfo.title.split(' / ').slice(1).join(' / ')}
              </>
            ) : (
              pageInfo.title
            )}
          </h1>
        )}
        {afterTitle && (
          <>
            <span className="text-border mx-1 hidden md:inline">|</span>
            {afterTitle}
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        <QuickScanButton isMobile={isMobile} />
        {actions}
      </div>
    </div>
  );
}

function QuickScanButton({ isMobile }: { isMobile: boolean }) {
  const navigate = useNavigate();

  return (
    <Button
      variant="default"
      size={isMobile ? 'sm' : 'default'}
      className="gap-1.5"
      onClick={() => navigate('/github/repositories')}
    >
      <Zap className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Quick Scan</span>
    </Button>
  );
}
