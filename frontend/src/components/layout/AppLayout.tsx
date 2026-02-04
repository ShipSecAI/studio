import { ThemeTransition } from '@/components/ui/ThemeTransition';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarItem,
} from '@/components/ui/sidebar';
import { AppTopBar } from '@/components/layout/AppTopBar';
import { Button } from '@/components/ui/button';
import {
  Workflow,
  KeyRound,
  Plus,
  Plug,
  Archive,
  CalendarClock,
  Sun,
  Moon,
  Shield,
  Search,
  Command,
  Zap,
  Webhook,
  Bot,
  MessageSquare,
  Trash2,
  Pencil,
  Check,
} from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { useChatStore } from '@/store/chatStore';
import { env } from '@/config/env';
import { useThemeStore } from '@/store/themeStore';
import { cn } from '@/lib/utils';
import { setMobilePlacementSidebarClose } from '@/components/layout/sidebar-state';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';

interface AppLayoutProps {
  children: React.ReactNode;
}

import { SidebarContext, type SidebarContextValue } from './sidebar-context';

// Custom hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [, setIsHovered] = useState(false);
  const [wasExplicitlyOpened, setWasExplicitlyOpened] = useState(!isMobile);
  const location = useLocation();
  const navigate = useNavigate();
  const roles = useAuthStore((state) => state.roles);
  const canManageWorkflows = hasAdminRole(roles);
  const { theme, startTransition } = useThemeStore();
  const openCommandPalette = useCommandPaletteStore((state) => state.open);

  // Chat conversation management
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    deleteConversation,
    renameConversation,
  } = useChatStore();
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleNewChat = useCallback(() => {
    setActiveConversation(null);
    navigate('/');
    if (isMobile) setSidebarOpen(false);
  }, [setActiveConversation, navigate, isMobile]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      navigate(`/c/${id}`);
      if (isMobile) setSidebarOpen(false);
    },
    [navigate, isMobile],
  );

  const handleDeleteConversation = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const wasActive = activeConversationId === id;
      deleteConversation(id);
      if (wasActive) {
        navigate('/');
      }
    },
    [deleteConversation, activeConversationId, navigate],
  );

  const handleStartRename = useCallback((e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingConversationId(id);
    setEditTitle(currentTitle);
  }, []);

  const handleSaveRename = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
      e.stopPropagation();
      if (editTitle.trim()) {
        renameConversation(id, editTitle.trim());
      }
      setEditingConversationId(null);
      setEditTitle('');
    },
    [editTitle, renameConversation],
  );

  const handleCancelRename = useCallback(() => {
    setEditingConversationId(null);
    setEditTitle('');
  }, []);

  // Demo user image (temporary hack)
  const demoUserImageUrl =
    'https://img.clerk.com/eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwczovL2ltYWdlcy5jbGVyay5kZXYvb2F1dGhfZ29vZ2xlL2ltZ18zMkZBb1JVSDBvenQ0bmp1ZG80aHliV0FHclcifQ?width=160';

  // Get git SHA for version display (monorepo - same for frontend and backend)
  const gitSha = env.VITE_GIT_SHA;
  // If it's a tag (starts with v), show full tag. Otherwise show first 7 chars of SHA
  const displayVersion =
    gitSha && gitSha !== '' && gitSha !== 'unknown'
      ? gitSha.startsWith('v')
        ? gitSha
        : gitSha.slice(0, 7)
      : 'dev';

  // Auto-collapse sidebar when opening workflow builder, expand for other routes
  // On mobile, always start collapsed
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setWasExplicitlyOpened(false);
    } else {
      const isWorkflowRoute =
        (location.pathname.startsWith('/workflows') ||
          location.pathname.startsWith('/webhooks/')) &&
        location.pathname !== '/';
      setSidebarOpen(!isWorkflowRoute);
      setWasExplicitlyOpened(!isWorkflowRoute);
    }
  }, [location.pathname, isMobile]);

  // Close sidebar on mobile when navigating
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, isMobile]);

  // Set up sidebar close callback for mobile component placement
  useEffect(() => {
    if (isMobile) {
      setMobilePlacementSidebarClose(() => {
        setSidebarOpen(false);
        setWasExplicitlyOpened(false);
      });
    }
    return () => {
      setMobilePlacementSidebarClose(() => {});
    };
  }, [isMobile]);

  // Handle hover to expand sidebar when collapsed (desktop only)
  const handleMouseEnter = () => {
    if (isMobile) return;
    setIsHovered(true);
    if (!sidebarOpen) {
      setSidebarOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (isMobile) return;
    setIsHovered(false);
    // Only collapse if it was expanded due to hover (not explicitly opened)
    if (!wasExplicitlyOpened && sidebarOpen) {
      setSidebarOpen(false);
    }
  };

  // Close sidebar when window loses focus (e.g., CMD+click opens new tab)
  useEffect(() => {
    const handleWindowBlur = () => {
      // Only collapse if it was expanded due to hover (not explicitly opened)
      if (!isMobile && !wasExplicitlyOpened && sidebarOpen) {
        setSidebarOpen(false);
        setIsHovered(false);
      }
    };

    const handleVisibilityChange = () => {
      // When tab becomes hidden (e.g., user switched tabs), collapse hover-opened sidebar
      if (document.hidden && !isMobile && !wasExplicitlyOpened && sidebarOpen) {
        setSidebarOpen(false);
        setIsHovered(false);
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isMobile, wasExplicitlyOpened, sidebarOpen]);

  const handleToggle = useCallback(() => {
    const newState = !sidebarOpen;
    setSidebarOpen(newState);
    setWasExplicitlyOpened(newState);
  }, [sidebarOpen]);

  // --- Swipe Gesture Logic for Mobile ---
  const [touchStart, setTouchStart] = useState<number | null>(null);

  useEffect(() => {
    if (!isMobile) return;

    const handleTouchStart = (e: TouchEvent) => {
      const x = e.touches[0].clientX;
      // Start tracking if touching near the left edge to open
      if (!sidebarOpen && x < 30) {
        setTouchStart(x);
      }
      // Or if sidebar is already open, track anywhere to detect closing swipe
      else if (sidebarOpen) {
        setTouchStart(x);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStart === null) return;

      const currentX = e.touches[0].clientX;
      const diff = currentX - touchStart;

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
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStart === null) return;

      const endX = e.changedTouches[0].clientX;
      const diff = endX - touchStart;
      const threshold = 50; // px to trigger toggle

      // Swipe right to open
      if (!sidebarOpen && diff > threshold && touchStart < 30) {
        setSidebarOpen(true);
        setWasExplicitlyOpened(true);
      }
      // Swipe left to close
      else if (sidebarOpen && diff < -threshold) {
        setSidebarOpen(false);
        setWasExplicitlyOpened(false);
      }

      setTouchStart(null);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isMobile, sidebarOpen, touchStart]);

  // Close sidebar when clicking backdrop on mobile
  const handleBackdropClick = useCallback(() => {
    if (isMobile && sidebarOpen) {
      setSidebarOpen(false);
      setWasExplicitlyOpened(false);
    }
  }, [isMobile, sidebarOpen]);

  const sidebarContextValue: SidebarContextValue = {
    isOpen: sidebarOpen,
    isMobile,
    toggle: handleToggle,
  };

  const navigationItems = [
    {
      name: 'AI Agent',
      href: '/',
      icon: Bot,
    },
    {
      name: 'Workflow Builder',
      href: '/workflows',
      icon: Workflow,
    },
    {
      name: 'Schedules',
      href: '/schedules',
      icon: CalendarClock,
    },
    {
      name: 'Webhooks',
      href: '/webhooks',
      icon: Webhook,
    },
    {
      name: 'Action Center',
      href: '/action-center',
      icon: Zap,
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
    ...(env.VITE_ENABLE_CONNECTIONS
      ? [
          {
            name: 'Connections',
            href: '/integrations',
            icon: Plug,
          },
        ]
      : []),
    {
      name: 'Artifact Library',
      href: '/artifacts',
      icon: Archive,
    },
  ];

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/c/');
    }
    if (path === '/workflows') {
      return location.pathname === '/workflows' || location.pathname.startsWith('/workflows/');
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  // Get page-specific actions
  const getPageActions = () => {
    if (location.pathname === '/workflows') {
      return (
        <Button
          onClick={() => {
            if (!canManageWorkflows) return;
            navigate('/workflows/new');
          }}
          size={isMobile ? 'sm' : 'default'}
          className={cn('gap-2', isMobile && 'h-8 px-3 text-xs')}
          disabled={!canManageWorkflows}
          aria-disabled={!canManageWorkflows}
        >
          <Plus className={cn('w-4 h-4', isMobile && 'w-3.5 h-3.5')} />
          <span>
            New <span className="hidden md:inline">Workflow</span>
          </span>
        </Button>
      );
    }

    return null;
  };

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
            isMobile && sidebarOpen && 'translate-x-0',
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Sidebar Header - same style for mobile and desktop */}
          <SidebarHeader className="flex items-center justify-between p-4 border-b">
            <Link
              to="/"
              className="flex items-center gap-2"
              onClick={() => isMobile && setSidebarOpen(false)}
            >
              <div className="flex-shrink-0">
                <img
                  src="/favicon.ico"
                  alt="ShipSec Studio"
                  className="w-6 h-6"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                  }}
                />
                <span className="hidden text-sm font-bold">SS</span>
              </div>
              <span
                className={cn(
                  'font-bold text-xl transition-all duration-300 whitespace-nowrap overflow-hidden',
                  sidebarOpen ? 'opacity-100 max-w-48' : 'opacity-0 max-w-0',
                )}
                style={{
                  transitionDelay: sidebarOpen ? '150ms' : '0ms',
                  transitionProperty: 'opacity, max-width',
                }}
              >
                ShipSec Studio
              </span>
            </Link>
          </SidebarHeader>

          <SidebarContent className="py-0">
            <div className={cn('px-2 mt-2 space-y-1')}>
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={(e) => {
                      // If modifier key is held (CMD+click, Ctrl+click), link opens in new tab
                      // Don't update sidebar state in this case
                      if (e.metaKey || e.ctrlKey || e.shiftKey) {
                        return;
                      }
                      // Close sidebar on mobile after navigation
                      if (isMobile) {
                        setSidebarOpen(false);
                        return;
                      }
                      // Keep sidebar open when navigating to non-workflow routes (desktop)
                      if (!item.href.startsWith('/workflows')) {
                        setSidebarOpen(true);
                        setWasExplicitlyOpened(true);
                      }
                    }}
                  >
                    <SidebarItem
                      isActive={active}
                      className={cn(
                        'flex items-center gap-3',
                        sidebarOpen ? 'justify-start px-4' : 'justify-center',
                      )}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      <span
                        className={cn(
                          'transition-all duration-300 whitespace-nowrap overflow-hidden flex-1',
                          sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                        )}
                        style={{
                          transitionDelay: sidebarOpen ? '200ms' : '0ms',
                          transitionProperty: 'opacity, max-width',
                        }}
                      >
                        {item.name}
                      </span>
                    </SidebarItem>
                  </Link>
                );
              })}
            </div>

            {/* Command Palette Button */}
            <div className="px-2 mt-4 pt-4 border-t border-border/40">
              <button
                onClick={openCommandPalette}
                className={cn(
                  'w-full flex items-center gap-3 py-2.5 rounded-lg transition-colors',
                  'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground',
                  sidebarOpen ? 'justify-between px-4' : 'justify-center',
                )}
              >
                <div className="flex items-center gap-3">
                  <Search className="h-4 w-4 flex-shrink-0" />
                  <span
                    className={cn(
                      'transition-all duration-300 whitespace-nowrap overflow-hidden text-sm',
                      sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                    )}
                    style={{
                      transitionDelay: sidebarOpen ? '200ms' : '0ms',
                      transitionProperty: 'opacity, max-width',
                    }}
                  >
                    Search...
                  </span>
                </div>
                {sidebarOpen && (
                  <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/60 bg-background/80 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                    <Command className="h-2.5 w-2.5" />K
                  </kbd>
                )}
              </button>
            </div>

            {/* Chat History Section */}
            {sidebarOpen && (
              <div className="px-2 mt-4 pt-4 border-t border-border/40 flex-1 overflow-y-auto">
                <div className="flex items-center justify-between px-2 mb-2">
                  <p className="text-xs font-medium text-muted-foreground">Your Chats</p>
                  <button
                    onClick={handleNewChat}
                    className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="New Chat"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <MessageSquare className="h-6 w-6 text-muted-foreground/40 mb-1.5" />
                    <p className="text-xs text-muted-foreground">No conversations yet</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      Start a new chat to begin
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {conversations.map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() =>
                          editingConversationId !== conv.id && handleSelectConversation(conv.id)
                        }
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left',
                          'transition-colors group cursor-pointer',
                          activeConversationId === conv.id
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Bot className="h-3.5 w-3.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          {editingConversationId === conv.id ? (
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(e, conv.id);
                                if (e.key === 'Escape') handleCancelRename();
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className={cn(
                                'w-full text-xs font-medium bg-background border border-input rounded px-1.5 py-0.5',
                                'focus:outline-none focus:ring-1 focus:ring-ring',
                              )}
                            />
                          ) : (
                            <>
                              <p className="text-xs font-medium truncate">{conv.title}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {conv.messages.length} messages
                              </p>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5">
                          {editingConversationId === conv.id ? (
                            <button
                              onClick={(e) => handleSaveRename(e, conv.id)}
                              className="p-0.5 rounded hover:bg-primary/10 text-primary"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => handleStartRename(e, conv.id, conv.title)}
                              className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted-foreground/10 text-muted-foreground"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDeleteConversation(e, conv.id)}
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </SidebarContent>

          <SidebarFooter className="border-t p-0">
            <div className="flex flex-col gap-1.5 p-2">
              <div
                className={`flex items-center gap-2 ${sidebarOpen ? 'justify-between' : 'justify-center'}`}
              >
                <div className="flex items-center gap-3">
                  <img
                    src={demoUserImageUrl}
                    alt="User avatar"
                    className="w-9 h-9 rounded-full ring-2 ring-border flex-shrink-0"
                  />
                  {sidebarOpen && (
                    <span
                      className={cn(
                        'text-sm font-medium transition-all duration-300 whitespace-nowrap overflow-hidden',
                        sidebarOpen ? 'opacity-100' : 'opacity-0 max-w-0',
                      )}
                      style={{
                        transitionDelay: sidebarOpen ? '200ms' : '0ms',
                        transitionProperty: 'opacity, max-width',
                      }}
                    >
                      Aseem Shrey
                    </span>
                  )}
                </div>
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
            </div>
          </SidebarFooter>

          {/* Version info - its own dedicated section at absolute bottom with animation */}
          <div className="px-2 py-1.5 border-t">
            <div className="h-4 flex items-center justify-center">
              <span
                className={cn(
                  'text-xs text-muted-foreground transition-all duration-300 whitespace-nowrap overflow-hidden block text-center',
                  sidebarOpen ? 'opacity-100 max-w-full' : 'opacity-0 max-w-0',
                )}
                style={{
                  transitionDelay: sidebarOpen ? '200ms' : '0ms',
                  transitionProperty: 'opacity, max-width',
                }}
              >
                version: {displayVersion}
              </span>
            </div>
          </div>
        </Sidebar>

        {/* Main content area */}
        <main
          className={cn(
            'flex-1 flex flex-col overflow-hidden min-w-0',
            // On mobile, main content takes full width since sidebar is overlay
            isMobile ? 'w-full' : '',
          )}
        >
          {/* Only show AppTopBar for non-agent, non-workflow-builder, and non-webhook-editor pages */}
          {location.pathname !== '/' &&
            !location.pathname.startsWith('/c/') &&
            !location.pathname.startsWith('/workflows') &&
            !location.pathname.startsWith('/webhooks/') && (
              <AppTopBar
                sidebarOpen={sidebarOpen}
                onSidebarToggle={handleToggle}
                actions={getPageActions()}
                isMobile={isMobile}
              />
            )}
          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
    </SidebarContext.Provider>
  );
}
