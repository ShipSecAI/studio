import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  Menu,
  X,
  Workflow,
  CalendarClock,
  Webhook,
  Zap,
  KeyRound,
  Shield,
  Archive,
  ChevronRight,
  Pencil,
  Check,
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
  { name: 'Workflow Builder', href: '/workflows', icon: Workflow },
  { name: 'Schedules', href: '/schedules', icon: CalendarClock },
  { name: 'Webhooks', href: '/webhooks', icon: Webhook },
  { name: 'Action Center', href: '/action-center', icon: Zap },
  { name: 'Secrets', href: '/secrets', icon: KeyRound },
  { name: 'API Keys', href: '/api-keys', icon: Shield },
  { name: 'Artifact Library', href: '/artifacts', icon: Archive },
];

export function AgentLayout({ children }: AgentLayoutProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [searchQuery, setSearchQuery] = useState('');
  const [studioExpanded, setStudioExpanded] = useState(false);
  const { theme, startTransition } = useThemeStore();

  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    deleteConversation,
    renameConversation,
  } = useChatStore();

  // Rename editing state
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Update sidebar state based on mobile
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const handleNewChat = useCallback(() => {
    setActiveConversation(null);
    navigate('/');
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [setActiveConversation, navigate, isMobile]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      navigate(`/c/${id}`);
      if (isMobile) {
        setSidebarOpen(false);
      }
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
                  {/* <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" />
                    Powered by Claude Opus
                  </span> */}
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
                  <div
                    key={conv.id}
                    onClick={() =>
                      editingConversationId !== conv.id && handleSelectConversation(conv.id)
                    }
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                      'transition-colors group cursor-pointer',
                      activeConversationId === conv.id
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Bot className="h-4 w-4 flex-shrink-0" />
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
                            'w-full text-sm font-medium bg-background border border-input rounded px-2 py-0.5',
                            'focus:outline-none focus:ring-1 focus:ring-ring',
                          )}
                        />
                      ) : (
                        <>
                          <p className="text-sm font-medium truncate">{conv.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.messages.length} messages
                          </p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {editingConversationId === conv.id ? (
                        <button
                          onClick={(e) => handleSaveRename(e, conv.id)}
                          className={cn(
                            'p-1 rounded transition-opacity',
                            'hover:bg-primary/10 text-primary',
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => handleStartRename(e, conv.id, conv.title)}
                          className={cn(
                            'p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                            'hover:bg-muted-foreground/10 text-muted-foreground',
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeleteConversation(e, conv.id)}
                        className={cn(
                          'p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                          'hover:bg-destructive/10 text-destructive',
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SidebarContent>

          <SidebarFooter className="border-t p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <img
                  src="https://img.clerk.com/eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwczovL2ltYWdlcy5jbGVyay5kZXYvb2F1dGhfZ29vZ2xlL2ltZ18zMkZBb1JVSDBvenQ0bmp1ZG80aHliV0FHclcifQ?width=160"
                  alt="User avatar"
                  className="w-10 h-10 rounded-full ring-2 ring-border"
                />
              </div>
              <Button variant="ghost" size="icon" onClick={startTransition} className="h-9 w-9">
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5 text-amber-500" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground text-center mt-3">
              version: v0.2 (e73fd1)
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
