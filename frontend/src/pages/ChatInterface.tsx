import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Search,
  AlertTriangle,
  Play,
  User,
  Pencil,
  Check,
  Link2,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChatCommandPalette, WorkflowPreviewPanel } from '@/components/chat';
import { RunInspectorSidePanel } from '@/components/chat/RunInspectorSidePanel';
import { useChatStore } from '@/store/chatStore';
import { useAuth } from '@/auth/auth-context';
import { useSidebar } from '@/components/layout/sidebar-context';
import { useChat } from '@ai-sdk/react';
import { isToolOrDynamicToolUIPart } from 'ai';
import { readUIMessageStream } from 'ai';
import type { UIMessage } from 'ai';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import { StatusBar } from '@/components/agent/StatusBar';
import { useToast } from '@/components/ui/use-toast';
import { DurableChatTransport } from '@/lib/durable-chat-transport';

// AI Elements
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { WorkflowRunStatusCard } from '@/components/ai-elements/workflow-run-status-card';
import { parseWorkflowRunOutput } from '@/utils/workflowRunParsing';

import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputButton,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';

// Get user's first name or fallback
function getUserName(user: { email?: string; firstName?: string | null } | null): string {
  if (!user) return 'there';
  if (user.firstName) return user.firstName;
  if (user.email) return user.email.split('@')[0];
  return 'there';
}

// Extract text content from a UIMessage's parts
function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

// Message component using AI Elements
interface ChatMessageProps {
  message: UIMessage;
  isStreaming: boolean;
  userImageUrl?: string;
}

function ChatMessageItem({ message, isStreaming, userImageUrl }: ChatMessageProps) {
  const isAssistant = message.role === 'assistant';
  const hasContent = message.parts.some(
    (p) => (p.type === 'text' && p.text) || isToolOrDynamicToolUIPart(p),
  );
  const isEmptyAssistant = isAssistant && !hasContent;

  return (
    <div className={`flex gap-3 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      {/* AI avatar on left */}
      {isAssistant && (
        <Avatar className="h-8 w-8 mt-1 shrink-0">
          <AvatarImage src="/favicon.ico" alt="ShipSec AI" />
          <AvatarFallback className="bg-primary/10 text-primary text-xs">AI</AvatarFallback>
        </Avatar>
      )}

      <div className={isAssistant ? 'max-w-[85%] min-w-0' : 'max-w-[70%] min-w-0'}>
        <Message from={message.role} className="max-w-full">
          <MessageContent
            className={
              isAssistant
                ? ''
                : 'group-[.is-user]:rounded-2xl group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground [&_*]:text-primary-foreground'
            }
          >
            {isEmptyAssistant && isStreaming ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                <span>Thinking...</span>
              </div>
            ) : (
              <>
                {message.parts.map((part, idx) => {
                  if (part.type === 'text') {
                    if (!part.text) return null;
                    return <MessageResponse key={`text-${idx}`}>{part.text}</MessageResponse>;
                  }

                  if (part.type === 'reasoning') {
                    if (!part.text) return null;
                    return (
                      <Reasoning key={`reasoning-${idx}`} isStreaming={part.state === 'streaming'}>
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );
                  }

                  if (isToolOrDynamicToolUIPart(part)) {
                    const toolId = part.toolCallId ?? `tool-${idx}`;
                    const displayState =
                      part.state === 'output-available' &&
                      'preliminary' in part &&
                      part.preliminary === true
                        ? 'input-available'
                        : part.state;
                    const partToolName = 'toolName' in part ? (part.toolName as string) : undefined;

                    const parsedWorkflowRun =
                      (part.state === 'output-available' || part.state === 'output-error') &&
                      'output' in part
                        ? parseWorkflowRunOutput((part as any).output)
                        : null;
                    const shouldRenderWorkflowRunCard =
                      parsedWorkflowRun !== null &&
                      (partToolName === 'run_workflow' ||
                        Boolean(parsedWorkflowRun.runId) ||
                        Boolean(parsedWorkflowRun.workflowId) ||
                        Boolean(parsedWorkflowRun.taskId));
                    return (
                      <Tool key={toolId}>
                        <ToolHeader
                          type={part.type as 'tool-invocation'}
                          state={displayState}
                          title={partToolName ?? part.type.split('-').slice(1).join('-')}
                        />
                        <ToolContent>
                          {'input' in part && part.input !== undefined && (
                            <ToolInput input={part.input} />
                          )}
                          {shouldRenderWorkflowRunCard && parsedWorkflowRun ? (
                            <WorkflowRunStatusCard run={parsedWorkflowRun} />
                          ) : (
                            (part.state === 'output-available' || part.state === 'output-error') &&
                            'output' in part && (
                              <ToolOutput
                                output={part.output}
                                errorText={
                                  'errorText' in part ? (part.errorText as string) : undefined
                                }
                              />
                            )
                          )}
                        </ToolContent>
                      </Tool>
                    );
                  }

                  return null;
                })}

                {/* Streaming cursor for assistant */}
                {isAssistant && isStreaming && getMessageText(message) && (
                  <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />
                )}
              </>
            )}
          </MessageContent>
        </Message>
      </div>

      {/* User avatar on right */}
      {!isAssistant && (
        <Avatar className="h-8 w-8 mt-1 shrink-0">
          {userImageUrl && <AvatarImage src={userImageUrl} alt="You" />}
          <AvatarFallback className="bg-muted text-muted-foreground text-xs">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

// Welcome screen action cards
const welcomeActions = [
  {
    icon: Search,
    title: 'Scan Repository',
    description: 'Run security scanners on your codebase',
    prompt: 'Scan my repository for security vulnerabilities',
  },
  {
    icon: Shield,
    title: 'Review Findings',
    description: 'Analyze and triage open findings',
    prompt: 'Show me the most critical security findings',
  },
  {
    icon: AlertTriangle,
    title: 'Investigate Alert',
    description: 'Deep-dive into a security alert',
    prompt: 'Help me investigate the latest security alert',
  },
  {
    icon: Play,
    title: 'Run Workflow',
    description: 'Execute a security automation workflow',
    prompt: 'Show me available security workflows',
  },
];

// Empty state component
interface EmptyStateProps {
  userName: string;
  onSelectPrompt: (prompt: string) => void;
}

function EmptyState({ userName, onSelectPrompt }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0">
      {/* Logo + Title */}
      <div className="mb-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col items-center gap-3">
          <img src="/favicon.ico" alt="ShipSec" className="w-12 h-12 rounded-xl" />
          <div className="text-center">
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground tracking-tight">
              ShipSec AI Agent
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Hi {userName}, how can I help secure your infrastructure?
            </p>
          </div>
        </div>
      </div>

      {/* 2x2 Action Card Grid */}
      <div className="w-full max-w-lg grid grid-cols-2 gap-3 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 delay-200">
        {welcomeActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.title}
              onClick={() => onSelectPrompt(action.prompt)}
              className="group relative flex flex-col items-start gap-2 rounded-xl border border-border/60 bg-card p-4 text-left transition-all duration-200 hover:border-primary/30 hover:shadow-md"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-foreground">{action.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {action.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Main Chat Interface
export function ChatInterface() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const { toast } = useToast();
  const {
    currentSessionId,
    createSession,
    startNewConversation,
    updateSessionTitle,
    getCurrentSession,
    setCommandPaletteOpen,
    loadSessions,
    setCurrentSession,
  } = useChatStore();

  const currentSession = getCurrentSession();

  // Ref to always have the latest sessionId available in the transport callback
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;
  // Track which session was lazily created so we skip message-loading for it
  const lazyCreatedSessionRef = useRef<string | null>(null);
  // Queue first message until useChat is bound to the durable session id.
  const pendingFirstMessageRef = useRef<string | null>(null);
  const isCreatingSessionRef = useRef(false);

  // Load sessions from server on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Route is canonical for selecting a conversation when present.
  useEffect(() => {
    if (routeSessionId === 'new') {
      // Respect explicit draft route, but don't clear immediately after we lazily
      // created a session from the first user message.
      if (
        currentSessionId &&
        !isCreatingSessionRef.current &&
        currentSessionId !== lazyCreatedSessionRef.current
      ) {
        startNewConversation();
      }
      return;
    }

    if (routeSessionId && routeSessionId !== currentSessionId) {
      setCurrentSession(routeSessionId);
    }
  }, [routeSessionId, currentSessionId, setCurrentSession, startNewConversation]);

  // Keep URL synced with active conversation selection.
  useEffect(() => {
    if (routeSessionId === 'new') {
      // Stay on draft URL unless this draft just materialized into a real session.
      if (currentSessionId && currentSessionId === lazyCreatedSessionRef.current) {
        navigate(`/chat/${currentSessionId}`, { replace: true });
      }
      return;
    }

    if (routeSessionId && routeSessionId !== 'new' && currentSessionId !== routeSessionId) {
      return;
    }

    const targetPath = currentSessionId ? `/chat/${currentSessionId}` : '/chat/new';
    const currentPath = routeSessionId ? `/chat/${routeSessionId}` : '/';

    if (targetPath !== currentPath) {
      navigate(targetPath, { replace: true });
    }
  }, [currentSessionId, routeSessionId, navigate]);

  // Create DurableChatTransport - handles both sending and reconnection
  const chatTransport = useMemo(
    () =>
      new DurableChatTransport({
        apiBase: API_V1_URL,
        getAuthHeaders: getApiAuthHeaders,
      }),
    [],
  );

  // Load messages for current session
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [chatId, setChatId] = useState(() =>
    currentSessionId ? currentSessionId : `chat-${Date.now()}`,
  );
  const [messagesLoaded, setMessagesLoaded] = useState(false);

  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    transport: chatTransport,
    id: chatId,
    messages: initialMessages,
    resume: messagesLoaded, // Only auto-reconnect after messages are loaded
  });

  const hydrateMessagesForSession = useCallback(
    async (sessionId: string): Promise<UIMessage[] | null> => {
      try {
        const authHeaders = await getApiAuthHeaders();
        const res = await fetch(`${API_V1_URL}/chat/sessions/${sessionId}/messages`, {
          headers: { ...authHeaders },
        });
        if (!res.ok) return null;
        const msgs = await res.json();
        const hydratedMessages = msgs.map((m: any) => ({
          id: m.id,
          role: m.role,
          parts: m.parts,
          createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
        }));
        setInitialMessages(hydratedMessages);
        setMessages(hydratedMessages);
        return hydratedMessages;
      } catch {
        return null;
      }
    },
    [setMessages],
  );

  useEffect(() => {
    if (!currentSessionId) {
      // User clicked "New Conversation" — reset chat to empty state
      setChatId(`new-${Date.now()}`);
      setInitialMessages([]);
      setMessages([]);
      setMessagesLoaded(true);
      return;
    }

    // Skip backend hydration for sessions created from this draft.
    // We already have local in-memory transcript (user + streaming assistant),
    // and re-hydrating too early can reset the chat to a partial server snapshot.
    if (lazyCreatedSessionRef.current === currentSessionId) {
      setChatId(currentSessionId);
      setMessagesLoaded(true);
      return;
    }

    // Session switch — load messages from server and reset useChat
    let cancelled = false;

    (async () => {
      const hydrated = await hydrateMessagesForSession(currentSessionId);
      if (!cancelled && hydrated) {
        setChatId(currentSessionId);
        setMessagesLoaded(true);
        return;
      }
      // Keep resume enabled even if initial hydration fails.
      if (!cancelled) {
        setChatId(currentSessionId);
        setMessagesLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, routeSessionId, hydrateMessagesForSession]);

  // Once the user switches away from the just-created session, clear the
  // marker so future visits hydrate from backend as usual.
  useEffect(() => {
    if (lazyCreatedSessionRef.current && currentSessionId !== lazyCreatedSessionRef.current) {
      lazyCreatedSessionRef.current = null;
    }
  }, [currentSessionId]);

  useEffect(() => {
    const pendingMessage = pendingFirstMessageRef.current;
    if (!pendingMessage || !currentSessionId) return;
    if (chatId !== currentSessionId) return;

    pendingFirstMessageRef.current = null;
    sendMessage({ text: pendingMessage });
  }, [chatId, currentSessionId, sendMessage]);

  // No more useChatReconnect hook - useChat with resume: true handles everything
  const displayMessages = messages;
  const effectiveStatus = status;

  useEffect(() => {
    if (!currentSessionId || !messagesLoaded) return;

    let cancelled = false;
    let streamAbortController: AbortController | null = null;
    let activePassiveRunId: string | null = null;

    const closePassiveStream = () => {
      streamAbortController?.abort();
      streamAbortController = null;
      activePassiveRunId = null;
    };

    const attachPassiveStream = async (runId: string) => {
      if (cancelled) return;
      if (status === 'streaming') return; // local tab already owns an active stream
      if (activePassiveRunId === runId) return;

      closePassiveStream();
      activePassiveRunId = runId;
      streamAbortController = new AbortController();

      // Pull latest persisted messages first so remote user messages show immediately.
      await hydrateMessagesForSession(currentSessionId);

      const stream = await chatTransport.reconnectToStream({ chatId: currentSessionId });
      if (!stream || cancelled) return;

      try {
        const iterator = readUIMessageStream({ stream });
        for await (const snapshot of iterator) {
          if (cancelled || activePassiveRunId !== runId) break;
          const current = messagesRef.current;
          const existingIndex = current.findIndex((message) => message.id === snapshot.id);
          if (existingIndex >= 0) {
            const next = [...current];
            next[existingIndex] = snapshot;
            setMessages(next);
          } else {
            setMessages([...current, snapshot]);
          }
        }
      } catch {
        // Best-effort passive stream
      } finally {
        closePassiveStream();
      }
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const authHeaders = await getApiAuthHeaders();
        const res = await fetch(`${API_V1_URL}/chat/sessions/${currentSessionId}/status`, {
          headers: { ...authHeaders },
        });
        if (!res.ok || cancelled) return;

        const body = (await res.json()) as {
          processingStatus: 'idle' | 'processing';
          activeRunId?: string | null;
        };

        if (body.processingStatus === 'processing' && body.activeRunId) {
          void attachPassiveStream(body.activeRunId);
          return;
        }

        if (activePassiveRunId) {
          closePassiveStream();
          await hydrateMessagesForSession(currentSessionId);
        }
      } catch {
        // Ignore transient polling errors
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      closePassiveStream();
    };
  }, [
    currentSessionId,
    messagesLoaded,
    status,
    chatTransport,
    hydrateMessagesForSession,
    setMessages,
  ]);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Reload sessions when streaming finishes to pick up AI-generated title
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      loadSessions();
    }
    prevStatusRef.current = status;
  }, [status, loadSessions]);

  // Handle prompt selection — set the textarea value via ref
  const [pendingPrompt, setPendingPrompt] = useState('');
  const handleSelectPrompt = useCallback((prompt: string) => {
    setPendingPrompt(prompt + ' ');
  }, []);

  // Handle submit from PromptInput — lazily creates a session if needed
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text?.trim();
      if (!text) return;

      // Create session on first message if none exists
      if (!sessionIdRef.current) {
        isCreatingSessionRef.current = true;
        try {
          const title = text.slice(0, 50) + (text.length > 50 ? '...' : '');
          // Mark this session as lazily created so we skip loading empty messages for it
          const newSessionId = await createSession(title);
          lazyCreatedSessionRef.current = newSessionId;
          sessionIdRef.current = newSessionId;
          setChatId(newSessionId);
          setMessagesLoaded(true);
          pendingFirstMessageRef.current = text;
          // Route transition is explicit to avoid relying on effect timing.
          navigate(`/chat/${newSessionId}`, { replace: true });
          return;
        } finally {
          isCreatingSessionRef.current = false;
        }
      }

      sendMessage({ text });
    },
    [sendMessage, createSession, navigate],
  );

  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar();
  const userImageUrl = (user as { imageUrl?: string } | null)?.imageUrl;

  // Editable title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');

  const handleStartEditTitle = useCallback(() => {
    if (currentSession) {
      setEditTitleValue(currentSession.title);
      setIsEditingTitle(true);
    }
  }, [currentSession]);

  const handleSaveTitle = useCallback(() => {
    const trimmed = editTitleValue.trim();
    if (trimmed && currentSessionId && trimmed !== currentSession?.title) {
      updateSessionTitle(currentSessionId, trimmed);
    }
    setIsEditingTitle(false);
  }, [editTitleValue, currentSessionId, currentSession?.title, updateSessionTitle]);

  const conversationPath = currentSessionId ? `/chat/${currentSessionId}` : '/chat/new';

  const conversationUrl = useMemo(() => {
    if (typeof window === 'undefined') return conversationPath;
    return `${window.location.origin}${conversationPath}`;
  }, [conversationPath]);

  const handleCopyConversationUrl = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(conversationUrl);
        toast({
          title: 'Conversation link copied',
          description: conversationPath,
        });
      } else {
        throw new Error('Clipboard unavailable');
      }
    } catch {
      toast({
        variant: 'destructive',
        title: 'Unable to copy link automatically',
        description: conversationUrl,
      });
    }
  }, [conversationUrl, conversationPath, toast]);

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Header: sidebar toggle + title + StatusBar */}
      <div className="flex items-center h-14 border-b bg-background/60 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          className="h-9 w-9 ml-2 shrink-0"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
        </Button>

        {/* Editable conversation title */}
        {currentSession ? (
          <div className="flex items-center gap-1 ml-2 min-w-0 max-w-[240px]">
            {isEditingTitle ? (
              <div className="flex items-center gap-1 min-w-0">
                <input
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  className="text-sm font-medium bg-muted px-2 py-0.5 rounded border border-border focus:outline-none focus:border-primary/50 min-w-0 w-full"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSaveTitle}
                  className="h-6 w-6 shrink-0"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                onClick={handleStartEditTitle}
                className="group flex items-center gap-1.5 min-w-0 px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
                title="Click to rename"
              >
                <span className="text-sm font-medium truncate">{currentSession.title}</span>
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            )}
          </div>
        ) : null}

        <button
          onClick={handleCopyConversationUrl}
          className="hidden md:inline-flex items-center gap-1.5 ml-1 px-2 py-1 rounded-md text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors max-w-[280px]"
          title={conversationUrl}
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{conversationPath}</span>
        </button>

        {/* Spacer pushes StatusBar to the right */}
        <div className="flex-1" />
        <StatusBar className="border-b-0" />
      </div>

      {/* Body: chat + inspector side-by-side */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0">
        {/* Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col relative min-w-0">
          {displayMessages.length === 0 ? (
            <EmptyState userName={getUserName(user)} onSelectPrompt={handleSelectPrompt} />
          ) : (
            <Conversation className="flex-1">
              <ConversationContent className="max-w-5xl mx-auto gap-6 px-4 py-6 md:px-8">
                {displayMessages.map((msg, idx) => (
                  <ChatMessageItem
                    key={msg.id}
                    message={msg}
                    isStreaming={
                      effectiveStatus === 'streaming' &&
                      msg.role === 'assistant' &&
                      idx === displayMessages.length - 1
                    }
                    userImageUrl={userImageUrl}
                  />
                ))}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          )}

          {/* Error display */}
          {error && (
            <div className="shrink-0 px-4">
              <div className="max-w-5xl mx-auto mb-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                {error.message || 'An error occurred while generating a response.'}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="shrink-0 p-4 md:pb-6 border-t bg-background/80 backdrop-blur-sm">
            <div className="max-w-5xl mx-auto space-y-3">
              <PromptInput
                onSubmit={handleSubmit}
                className="rounded-xl border border-border/60 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 shadow-sm transition-all duration-200"
              >
                <PromptInputTextarea
                  placeholder="Message ShipSec... (Type / for commands)"
                  autoFocus
                  value={pendingPrompt || undefined}
                  onChange={() => {
                    if (pendingPrompt) setPendingPrompt('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === '/' && e.currentTarget.value === '') {
                      e.preventDefault();
                      setCommandPaletteOpen(true);
                    }
                  }}
                />
                <PromptInputFooter>
                  <div className="flex items-center gap-1">
                    <PromptInputButton
                      tooltip="Commands"
                      onClick={() => setCommandPaletteOpen(true)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
                      </svg>
                    </PromptInputButton>
                  </div>
                  <div className="flex items-center gap-1">
                    <PromptInputSubmit status={effectiveStatus} onStop={stop} />
                  </div>
                </PromptInputFooter>
              </PromptInput>

              {/* Disclaimer */}
              <p className="text-center text-xs text-muted-foreground/70">
                ShipSec can make mistakes. Please verify important information.
              </p>
            </div>
          </div>
        </div>
        {/* end content+input column */}

        {/* Run Inspector — inline sidebar column */}
        <RunInspectorSidePanel />
      </div>
      {/* end body flex-row */}

      {/* Command Palette */}
      <ChatCommandPalette onSelectPrompt={handleSelectPrompt} />

      {/* Workflow Preview Panel */}
      <WorkflowPreviewPanel />
    </div>
  );
}
