import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Bot,
  Plus,
  Search,
  MessageSquare,
  Trash2,
  Sun,
  Moon,
  Settings,
  Menu,
  X,
  Sparkles,
  Workflow,
  CalendarClock,
  Webhook,
  Zap,
  KeyRound,
  Shield,
  Archive,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/store/themeStore';
import { useChatStore } from '@/store/chatStore';
import { ThemeTransition } from '@/components/ui/ThemeTransition';

interface AgentLayoutProps {
  children: React.ReactNode;
}

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

const studioNavItems = [
  { name: 'Workflow Builder', href: '/studio', icon: Workflow },
  { name: 'Schedules', href: '/studio/schedules', icon: CalendarClock },
  { name: 'Webhooks', href: '/studio/webhooks', icon: Webhook },
  { name: 'Action Center', href: '/studio/action-center', icon: Zap },
  { name: 'Secrets', href: '/studio/secrets', icon: KeyRound },
  { name: 'API Keys', href: '/studio/api-keys', icon: Shield },
  { name: 'Artifact Library', href: '/studio/artifacts', icon: Archive },
];

export function AgentLayout({ children }: AgentLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [searchQuery, setSearchQuery] = useState('');
  const [studioExpanded, setStudioExpanded] = useState(false);
  const { theme, startTransition } = useThemeStore();

  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    createConversation,
    deleteConversation,
  } = useChatStore();

  // Update sidebar state based on mobile
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const handleNewChat = useCallback(() => {
    createConversation();
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [createConversation, isMobile]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversation(id);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [setActiveConversation, isMobile],
  );

  const handleDeleteConversation = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      deleteConversation(id);
    },
    [deleteConversation],
  );

  const filteredConversations = conversations.filter((conv) =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <>
      <ThemeTransition />
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Mobile backdrop */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <Sidebar
          className={cn(
            'h-full transition-all duration-300 z-[110]',
            isMobile ? 'fixed left-0 top-0' : 'relative',
            sidebarOpen ? 'w-72' : isMobile ? 'w-0 -translate-x-full' : 'w-0',
          )}
        >
          {/* Header with logo and agent info */}
          <SidebarHeader className="flex flex-col gap-3 p-4 border-b">
            <div className="flex items-center justify-between">
              <Link to="/" className="flex items-center gap-2">
                <div className="relative">
                  <img
                    src="/favicon.ico"
                    alt="ShipSec"
                    className="w-8 h-8"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-lg">ShipSec AI</span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    Powered by Claude Opus
                  </span>
                </div>
              </Link>
              {isMobile && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(false)}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* New chat button */}
            <Button onClick={handleNewChat} className="w-full gap-2" variant="outline">
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </SidebarHeader>

          <SidebarContent className="flex flex-col p-3 gap-3">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>

            {/* Studio Navigation - Collapsible */}
            <div className="border-b border-border/40 pb-3">
              <button
                onClick={() => setStudioExpanded(!studioExpanded)}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium',
                  'text-muted-foreground hover:text-foreground transition-colors',
                )}
              >
                <span>Studio</span>
                <ChevronRight
                  className={cn('h-3.5 w-3.5 transition-transform', studioExpanded && 'rotate-90')}
                />
              </button>
              {studioExpanded && (
                <div className="mt-1 space-y-0.5">
                  {studioNavItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm',
                          'text-muted-foreground hover:text-foreground hover:bg-muted',
                          'transition-colors',
                        )}
                        onClick={() => isMobile && setSidebarOpen(false)}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Conversation history */}
            <div className="flex-1 overflow-y-auto space-y-1">
              <p className="text-xs font-medium text-muted-foreground px-2 py-1">Your Chats</p>
              {filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">No conversations yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Start a new chat to begin</p>
                </div>
              ) : (
                filteredConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                      'transition-colors group',
                      activeConversationId === conv.id
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Bot className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{conv.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.messages.length} messages
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteConversation(e, conv.id)}
                      className={cn(
                        'p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                        'hover:bg-destructive/10 text-destructive',
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </button>
                ))
              )}
            </div>
          </SidebarContent>

          <SidebarFooter className="border-t p-3">
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="gap-2 flex-1 justify-start">
                <Settings className="h-4 w-4" />
                <span className="text-sm">Settings</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={startTransition} className="h-8 w-8">
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 text-amber-500" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground/60 text-center mt-2">
              ShipSec AI v1.0.0 | Claude Opus 4.5
            </div>
          </SidebarFooter>
        </Sidebar>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Mobile header */}
          {isMobile && (
            <div className="flex items-center gap-3 p-3 border-b bg-background">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="h-9 w-9"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <img
                  src="/favicon.ico"
                  alt="ShipSec"
                  className="w-6 h-6"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <span className="font-semibold">ShipSec AI</span>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-hidden">{children}</div>
        </main>
      </div>
    </>
  );
}
