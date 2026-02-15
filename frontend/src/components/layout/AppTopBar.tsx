import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';

interface AppTopBarProps {
  title?: string;
  subtitle?: string;
  showSidebarToggle?: boolean;
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
  actions?: React.ReactNode;
  isMobile?: boolean;
}

export function AppTopBar({
  title,
  subtitle,
  showSidebarToggle = true,
  sidebarOpen,
  onSidebarToggle,
  actions,
  isMobile = false,
}: AppTopBarProps) {
  const location = useLocation();
  const [hasActiveScans, setHasActiveScans] = useState(false);
  const [loadingActiveScans, setLoadingActiveScans] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadActiveScans = async () => {
      try {
        const headers = await getApiAuthHeaders();
        const response = await fetch(
          `${API_BASE_URL}/api/v1/github/scans?status=running,pending&limit=1`,
          { headers },
        );
        if (!response.ok) return;
        const scans = (await response.json()) as unknown;
        if (cancelled) return;
        setHasActiveScans(Array.isArray(scans) && scans.length > 0);
      } catch {
        if (!cancelled) {
          setHasActiveScans(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingActiveScans(false);
        }
      }
    };

    setLoadingActiveScans(true);
    loadActiveScans().catch(() => {});

    const timer = window.setInterval(() => {
      loadActiveScans().catch(() => {});
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Determine page title and navigation based on current route
  const getPageInfo = () => {
    if (title) return { title, subtitle };

    if (location.pathname === '/') {
      return {
        title: 'Security Workflow Builder',
        shortTitle: 'Workflows',
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

    if (env.VITE_ENABLE_CONNECTIONS && location.pathname === '/integrations') {
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

    if (location.pathname.startsWith('/dashboards/aws-security')) {
      return {
        title: 'Security Dashboard',
        shortTitle: 'Security',
        subtitle: 'AWS Security Findings from Prowler',
      };
    }

    if (location.pathname.startsWith('/integrations/github')) {
      return {
        title: 'Integrations / GitHub Integration',
        shortTitle: 'GitHub',
        subtitle: 'Manage repositories, trigger rules, and scan results',
        breadcrumb: { label: 'Integrations', href: '/integrations' },
      };
    }

    if (location.pathname.startsWith('/integrations/')) {
      const providerSlug = location.pathname.split('/')[2] ?? '';
      const providerNames: Record<string, string> = {
        aws: 'Amazon Web Services',
        slack: 'Slack',
      };
      const providerName =
        providerNames[providerSlug] ?? providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1);
      return {
        title: `Integrations / ${providerName}`,
        shortTitle: providerName,
        subtitle: `Manage ${providerName} connections`,
        breadcrumb: { label: 'Integrations', href: '/integrations' },
      };
    }

    return {
      title: 'Security Workflow Builder',
      shortTitle: 'Workflows',
      subtitle: 'Create and manage security automation workflows',
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
            {/* Show page title on non-workflow pages */}
            {location.pathname !== '/' && !location.pathname.startsWith('/workflows') && (
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
          <h1 className="text-xl font-semibold truncate">
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
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {hasActiveScans && (
          <Button variant="outline" size={isMobile ? 'sm' : 'default'} asChild>
            <Link to="/integrations/github?tab=scans&status=running,pending">
              {loadingActiveScans ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              )}
              Live scans
            </Link>
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
