import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolvePageTitle } from '@/config/pageTitles';
import { QuickScanDialog } from '@/components/home/QuickScanDialog';

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

  // Resolve page info from centralized config, with prop overrides
  const resolved = resolvePageTitle(location.pathname);
  const pageInfo = title
    ? { title, shortTitle: title, subtitle: subtitle ?? '', icon: undefined, breadcrumb: undefined }
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
        {/* Mobile: ShipSec Studio stacked | Page Title */}
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
            {/* Show page title on non-home pages */}
            {location.pathname !== '/' && (
              <>
                <span className="text-muted-foreground">|</span>
                <span className="font-medium text-sm truncate">
                  {pageInfo.shortTitle || pageInfo.title}
                </span>
              </>
            )}
          </div>
        ) : !afterTitle ? (
          /* Desktop: Icon + Full page title (hidden when afterTitle like SecurityTabBar is shown) */
          <div className="flex items-center gap-2.5">
            {PageIcon && <PageIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
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
                  {pageInfo.title.includes(' / ')
                    ? pageInfo.title.split(' / ').slice(1).join(' / ')
                    : pageInfo.title}
                </>
              ) : (
                pageInfo.title
              )}
            </h1>
          </div>
        ) : null}
        {afterTitle}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        {!location.pathname.startsWith('/chat') && <QuickScanButton isMobile={isMobile} />}
        {actions}
      </div>
    </div>
  );
}

function QuickScanButton({ isMobile }: { isMobile: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="default"
        size={isMobile ? 'sm' : 'default'}
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Zap className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Quick Scan</span>
      </Button>
      <QuickScanDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
