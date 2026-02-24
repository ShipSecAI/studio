import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolvePageTitle } from '@/config/pageTitles';
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

  // Resolve page info from centralized config, with prop overrides
  const resolved = resolvePageTitle(location.pathname);
  const pageInfo = title
    ? { title, shortTitle: title, subtitle: subtitle ?? '', icon: undefined }
    : { ...resolved };

  const PageIcon = pageInfo.icon;

  return (
    <div
      className={cn(
        'h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
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
            {/* Show page title on non-root pages */}
            {location.pathname !== '/' && (
              <>
                <span className="text-muted-foreground">|</span>
                <span className="font-medium text-sm truncate">
                  {pageInfo.shortTitle || pageInfo.title}
                </span>
              </>
            )}
          </div>
        ) : (
          /* Desktop: Icon + Full page title */
          <div className="flex items-center gap-2.5">
            {PageIcon && <PageIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
            <h1 className="text-xl font-semibold truncate">{pageInfo.title}</h1>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {hasActiveScans && (
          <Button variant="outline" size={isMobile ? 'sm' : 'default'} asChild>
            <Link to="/github?tab=scans&status=running,pending">
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
