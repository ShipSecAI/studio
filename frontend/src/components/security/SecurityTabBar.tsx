import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useSecurityViewStore } from '@/store/securityViewStore';
import { useSecurityDashboardStore } from '@/store/securityDashboardStore';
import { getBuiltInView } from '@/config/securityViews';

export function SecurityTabBar() {
  const {
    activeViewId,
    openViewIds,
    closedBuiltInIds,
    setActiveView,
    closeView,
    reopenBuiltInView,
    resetViews,
  } = useSecurityViewStore();
  const setViewFilter = useSecurityDashboardStore((s) => s.setViewFilter);
  const [searchParams, setSearchParams] = useSearchParams();

  // Sync ?view= param to store — only re-run when the view param itself changes,
  // not when other params (page, sort, etc.) change, to avoid resetting the page.
  const viewParam = searchParams.get('view');
  useEffect(() => {
    const targetViewId = viewParam ?? 'home';
    if (targetViewId !== activeViewId) {
      const view = getBuiltInView(targetViewId);
      if (view && !view.disabled) {
        // If the tab was closed, reopen it (which also sets it active)
        if (!openViewIds.includes(targetViewId)) {
          reopenBuiltInView(targetViewId);
        } else {
          setActiveView(targetViewId);
        }
        setViewFilter(view.baseFilter);
      }
    } else {
      const view = getBuiltInView(activeViewId);
      if (view) {
        setViewFilter(view.baseFilter);
      }
    }
  }, [viewParam]);

  const updateUrlParam = (viewId: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (viewId === 'home') {
          next.delete('view');
        } else {
          next.set('view', viewId);
        }
        return next;
      },
      { replace: true },
    );
  };

  const handleTabClick = (viewId: string) => {
    const view = getBuiltInView(viewId);
    if (view?.disabled) return;

    setActiveView(viewId);
    if (view) {
      setViewFilter(view.baseFilter);
    }
    updateUrlParam(viewId);
  };

  const handleClose = (e: React.MouseEvent, viewId: string) => {
    e.stopPropagation();
    closeView(viewId);

    // If we closed the active view, the store auto-switches; sync the view filter
    const newActiveId = useSecurityViewStore.getState().activeViewId;
    const newView = getBuiltInView(newActiveId);
    if (newView) {
      setViewFilter(newView.baseFilter);
      updateUrlParam(newActiveId);
    }
  };

  const handleReopen = (viewId: string) => {
    reopenBuiltInView(viewId);
    const view = getBuiltInView(viewId);
    if (view) {
      setViewFilter(view.baseFilter);
      updateUrlParam(viewId);
    }
  };

  const handleReset = () => {
    resetViews();
    const view = getBuiltInView('home');
    if (view) {
      setViewFilter(view.baseFilter);
      updateUrlParam('home');
    }
  };

  const closedViews = closedBuiltInIds
    .map((id) => getBuiltInView(id))
    .filter((v): v is NonNullable<typeof v> => v != null && !v.disabled);

  const hasClosedViews = closedViews.length > 0;

  // Scroll-fade state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollState, openViewIds]);

  return (
    <div className="relative min-w-0 flex-1">
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-background to-transparent pointer-events-none z-10" />
      )}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
      )}
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide"
      >
        {openViewIds.map((viewId) => {
          const view = getBuiltInView(viewId);
          if (!view) return null;

          const isActive = viewId === activeViewId;
          const isDisabled = view.disabled;
          const Icon = view.icon;

          return (
            <button
              key={viewId}
              onClick={() => handleTabClick(viewId)}
              disabled={isDisabled}
              className={cn(
                'group relative flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap rounded-md',
                'transition-colors',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                isDisabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Icon className="h-3 w-3 flex-shrink-0" />
              <span>{view.label}</span>
              {isDisabled && (
                <Badge variant="outline" className="ml-0.5 text-[9px] px-1 py-0 h-3.5">
                  Soon
                </Badge>
              )}
              {!isDisabled &&
                openViewIds.length > 1 &&
                viewId !== 'home' &&
                viewId !== 'all-findings' && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleClose(e, viewId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClose(e as unknown as React.MouseEvent, viewId);
                      }
                    }}
                    className={cn(
                      'ml-0.5 rounded-sm p-0.5 transition-opacity',
                      'opacity-0 group-hover:opacity-100',
                      isActive && 'opacity-60 group-hover:opacity-100',
                    )}
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                )}
            </button>
          );
        })}

        {/* Re-open closed tabs / reset */}
        {hasClosedViews && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0 ml-0.5">
                <Plus className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {closedViews.map((view) => {
                const Icon = view.icon;
                return (
                  <DropdownMenuItem key={view.id} onClick={() => handleReopen(view.id)}>
                    <Icon className="h-4 w-4 mr-2" />
                    {view.label}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset all tabs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
