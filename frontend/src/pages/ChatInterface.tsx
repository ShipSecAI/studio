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
  ExternalLink,
  Workflow,
  ChevronDown,
  ChevronUp,
  Plus,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChatCommandPalette, WorkflowPreviewPanel } from '@/components/chat';
import { RunInspectorSidePanel } from '@/components/chat/RunInspectorSidePanel';
import { EmbeddedRunGraph } from '@/components/chat/EmbeddedRunGraph';
import { useExecutionRun } from '@/hooks/queries/useExecutionQueries';
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
    newConversationToken,
    selectedRunId,
    isRunInspectorOpen,
  } = useChatStore();
  const { data: selectedRunData } = useExecutionRun(selectedRunId);

  const currentSession = getCurrentSession();

  // Ref to always have the latest sessionId available in the transport callback
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;
  // Route is canonical for which session should currently render.
  const routeSessionIdRef = useRef<string | null>(
    routeSessionId && routeSessionId !== 'new' ? routeSessionId : null,
  );
  routeSessionIdRef.current = routeSessionId && routeSessionId !== 'new' ? routeSessionId : null;
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
      // Keep /chat/new as a clean draft, except during the brief handoff
      // when a draft has just been materialized into a persisted session.
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

  // Route is the source of truth. Only normalize root "/" to a chat URL.
  useEffect(() => {
    if (routeSessionId !== undefined) return;
    navigate(currentSessionId ? `/chat/${currentSessionId}` : '/chat/new', { replace: true });
  }, [routeSessionId, currentSessionId, navigate]);

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
  const [sessionProcessing, setSessionProcessing] = useState(false);
  const [sessionProcessingStartedAtMs, setSessionProcessingStartedAtMs] = useState<number | null>(
    null,
  );

  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    transport: chatTransport,
    id: chatId,
    messages: initialMessages,
    resume: messagesLoaded, // Only auto-reconnect after messages are loaded
  });

  const fetchMessagesForSession = useCallback(
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
        return hydratedMessages;
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (newConversationToken > 0 && !currentSessionId) {
      setChatId(`new-${Date.now()}`);
      setInitialMessages([]);
      setMessages([]);
      setMessagesLoaded(true);
      setSessionProcessing(false);
      setSessionProcessingStartedAtMs(null);
      pendingFirstMessageRef.current = null;
      isCreatingSessionRef.current = false;
    }
  }, [newConversationToken, currentSessionId, setMessages]);

  useEffect(() => {
    if (routeSessionId === 'new') {
      // Ensure local chat state is always reset when landing on the new draft route.
      setChatId(`new-${Date.now()}`);
      setInitialMessages([]);
      setMessages([]);
      setMessagesLoaded(true);
      setSessionProcessing(false);
      setSessionProcessingStartedAtMs(null);
      pendingFirstMessageRef.current = null;
      isCreatingSessionRef.current = false;
      sessionIdRef.current = null;
      return;
    }

    if (!currentSessionId) {
      // User clicked "New Conversation" — reset chat to empty state
      setChatId(`new-${Date.now()}`);
      setInitialMessages([]);
      setMessages([]);
      setMessagesLoaded(true);
      setSessionProcessing(false);
      setSessionProcessingStartedAtMs(null);
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
    const targetSessionId = currentSessionId;
    let cancelled = false;
    setChatId(targetSessionId);
    setInitialMessages([]);
    setMessages([]);
    setMessagesLoaded(false);
    setSessionProcessing(false);
    setSessionProcessingStartedAtMs(null);

    (async () => {
      const hydrated = await fetchMessagesForSession(targetSessionId);
      if (cancelled || routeSessionIdRef.current !== targetSessionId) {
        return;
      }

      if (hydrated) {
        setInitialMessages(hydrated);
        setMessages(hydrated);
      } else {
        setInitialMessages([]);
        setMessages([]);
      }

      setMessagesLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, routeSessionId, fetchMessagesForSession, setMessages]);

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
  const isAgentWorking = effectiveStatus === 'streaming' || sessionProcessing;
  const [workingStartedAtMs, setWorkingStartedAtMs] = useState<number | null>(null);
  const [workingElapsedSeconds, setWorkingElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isAgentWorking) {
      setWorkingStartedAtMs(null);
      setWorkingElapsedSeconds(0);
      return;
    }

    setWorkingStartedAtMs((prev) => {
      if (sessionProcessingStartedAtMs) {
        return sessionProcessingStartedAtMs;
      }
      return prev ?? Date.now();
    });
  }, [isAgentWorking, sessionProcessingStartedAtMs]);

  useEffect(() => {
    if (!isAgentWorking || workingStartedAtMs === null) return;

    const updateElapsed = () => {
      setWorkingElapsedSeconds(Math.max(0, Math.floor((Date.now() - workingStartedAtMs) / 1000)));
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [isAgentWorking, workingStartedAtMs]);

  const workingElapsedLabel = useMemo(() => {
    const minutes = Math.floor(workingElapsedSeconds / 60);
    const seconds = workingElapsedSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }, [workingElapsedSeconds]);

  useEffect(() => {
    if (!currentSessionId || !messagesLoaded) return;

    let cancelled = false;
    let streamAbortController: AbortController | null = null;

    const closePassiveStream = () => {
      streamAbortController?.abort();
      streamAbortController = null;
      activePassiveRunIdRef.current = null;
    };

    const hydrateActiveSessionSafely = async () => {
      const hydrated = await fetchMessagesForSession(currentSessionId);
      if (cancelled || routeSessionIdRef.current !== currentSessionId || !hydrated) {
        return null;
      }
      setInitialMessages(hydrated);
      setMessages(hydrated);
      return hydrated;
    };

    const attachPassiveStream = async (runId: string) => {
      if (cancelled) return;
      if (statusRef.current === 'streaming') return; // local tab already owns an active stream
      // Bug 3: guard with ref so re-runs of this effect don't re-attach the same run
      if (activePassiveRunIdRef.current === runId) return;

      closePassiveStream();
      activePassiveRunIdRef.current = runId;
      streamAbortController = new AbortController();

      // Pull latest persisted messages first so remote user messages show immediately.
      await hydrateActiveSessionSafely();

      const stream = await chatTransport.reconnectToStream({ chatId: currentSessionId });
      if (!stream || cancelled) return;

      try {
        const iterator = readUIMessageStream({ stream });
        for await (const snapshot of iterator) {
          if (cancelled || activePassiveRunIdRef.current !== runId) break;
          if (routeSessionIdRef.current !== currentSessionId) break;
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

    // Bug 2: reset staleness counter when a new session/effect starts
    processingTicksRef.current = 0;
    setPollingStale(false);

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
          activeRunStartedAt?: string | null;
        };

        if (body.processingStatus === 'processing' && body.activeRunId) {
          // Bug 2: detect zombie sessions — if we've been processing for > 5 min stop polling
          processingTicksRef.current += 1;
          if (processingTicksRef.current > 200) {
            window.clearInterval(intervalId);
            setPollingStale(true);
            return;
          }

          setSessionProcessing(true);
          setSessionProcessingStartedAtMs(
            body.activeRunStartedAt ? new Date(body.activeRunStartedAt).getTime() : null,
          );
          void attachPassiveStream(body.activeRunId);
          return;
        }

        // Status returned to idle — reset staleness counter
        processingTicksRef.current = 0;
        setPollingStale(false);
        setSessionProcessing(false);
        setSessionProcessingStartedAtMs(null);
        if (activePassiveRunIdRef.current) {
          closePassiveStream();
          await hydrateActiveSessionSafely();
        }
      } catch {
        // Ignore transient polling errors
      }
    };

    void poll();
    // eslint-disable-next-line prefer-const -- intervalId is referenced inside poll() before it's assigned
    let intervalId = window.setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      closePassiveStream();
      setSessionProcessing(false);
      setSessionProcessingStartedAtMs(null);
    };

    // statusRef to avoid restarting the polling loop (and resetting activePassiveRunIdRef) on every
    // status transition (submitted→streaming→ready). See ENG-218.
  }, [currentSessionId, messagesLoaded, chatTransport, fetchMessagesForSession, setMessages]);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep a ref to status so the polling effect can read it without being in its deps.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Ref to deduplicate passive stream attachment across effect re-runs (Bug 3).
  const activePassiveRunIdRef = useRef<string | null>(null);

  // Staleness counter: how many consecutive 1.5s ticks the session has been 'processing' (Bug 2).
  const processingTicksRef = useRef(0);
  const [pollingStale, setPollingStale] = useState(false);

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
  const [graphPanelRun, setGraphPanelRun] = useState<{ runId: string; workflowId: string } | null>(
    null,
  );
  const [isGraphPanelOpen, setIsGraphPanelOpen] = useState(false);
  const handleSelectPrompt = useCallback((prompt: string) => {
    setPendingPrompt(prompt + ' ');
  }, []);

  const graphPanelUrl = useMemo(() => {
    if (!graphPanelRun) return '';
    return `/workflows/${graphPanelRun.workflowId}/runs/${graphPanelRun.runId}`;
  }, [graphPanelRun]);

  useEffect(() => {
    const runWorkflowId = selectedRunData?.workflowId;
    if (!selectedRunId || !runWorkflowId) return;
    setGraphPanelRun((prev) => {
      if (prev && prev.runId === selectedRunId && prev.workflowId === runWorkflowId) {
        return prev;
      }
      return { runId: selectedRunId, workflowId: runWorkflowId };
    });
  }, [selectedRunId, selectedRunData?.workflowId]);

  // Graph panel is tethered to the Run Inspector lifecycle.
  useEffect(() => {
    if (!isRunInspectorOpen) {
      setIsGraphPanelOpen(false);
    }
  }, [isRunInspectorOpen]);

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
      <div className="flex items-center h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-3 md:px-4 gap-2 md:gap-4 sticky top-0 z-40">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          className="h-9 w-9 shrink-0"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
        </Button>

        {/* Editable conversation title */}
        {currentSession ? (
          <div className="flex items-center gap-1 min-w-0 max-w-[240px]">
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
          className="hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors max-w-[280px]"
          title={conversationUrl}
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{conversationPath}</span>
        </button>

        {/* Spacer pushes actions to the right */}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            startNewConversation();
            navigate('/chat/new');
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Chat</span>
        </Button>
        <StatusBar className="border-b-0" />
      </div>
      {/* Body: chat + history + inspector side-by-side */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0">
        {/* Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col relative min-w-0">
          {/* Top slide-over graph reveal panel */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-20 transition-all duration-300 ease-out ${
              isGraphPanelOpen && isRunInspectorOpen
                ? 'translate-y-0 opacity-100'
                : '-translate-y-[105%] opacity-0'
            }`}
          >
            {graphPanelRun && isRunInspectorOpen && (
              <div className="relative ml-auto mr-0 h-[52vh] w-[min(100%,72rem)] rounded-b-none rounded-bl-xl border border-t-0 border-r-0 bg-background/95 shadow-lg backdrop-blur-sm">
                <div className="flex h-full flex-col px-3 py-2 md:px-4 pointer-events-auto">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Execution Graph</p>
                      <p className="truncate text-xs text-muted-foreground font-mono">
                        {graphPanelRun.runId}
                      </p>
                    </div>
                    <div className="flex items-center">
                      <Button variant="outline" size="sm" asChild className="h-8 gap-1.5">
                        <a href={graphPanelUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open Full Page
                        </a>
                      </Button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
                    <EmbeddedRunGraph
                      workflowId={graphPanelRun.workflowId}
                      runId={graphPanelRun.runId}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Single graph toggle tab: slides with the panel and docks to sidebar edge */}
          {graphPanelRun && isRunInspectorOpen && (
            <button
              onClick={() => setIsGraphPanelOpen((open) => !open)}
              className={`absolute right-0 top-0 z-30 -translate-x-px inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-y border-l border-r-0 bg-background px-2.5 text-xs font-medium transition-all duration-300 ease-out hover:bg-muted ${
                isGraphPanelOpen ? 'translate-y-[calc(52vh-1px)]' : 'translate-y-0'
              }`}
              title={isGraphPanelOpen ? 'Hide workflow graph' : 'Show workflow graph'}
            >
              <Workflow className="h-3.5 w-3.5 text-primary" />
              <span className="tracking-wide">
                {isGraphPanelOpen ? 'Close Graph' : 'Open Graph'}
              </span>
              {isGraphPanelOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          )}

          {displayMessages.length === 0 ? (
            <EmptyState userName={getUserName(user)} onSelectPrompt={handleSelectPrompt} />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-end gap-4 px-4 py-4 md:px-6">
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
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="shrink-0 px-4">
              <div className="max-w-5xl mx-auto mb-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                {error.message || 'An error occurred while generating a response.'}
              </div>
            </div>
          )}

          {/* Stale polling warning — shown when the session has been stuck in 'processing' for >5 min */}
          {pollingStale && (
            <div className="shrink-0 px-4">
              <div className="max-w-5xl mx-auto mb-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-md text-sm text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                This session has been processing for over 5 minutes. It may be stuck. Try refreshing
                or starting a new session.
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="shrink-0 border-t bg-background/85 px-3 py-2 backdrop-blur-sm md:px-4 md:py-3">
            <div className="mx-auto max-w-5xl space-y-2">
              <div className="min-h-5">
                {isAgentWorking ? (
                  <div className="flex justify-start">
                    <div className="relative overflow-hidden rounded-full border border-border/70 bg-muted/70 px-3 py-1 text-xs text-muted-foreground">
                      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shipsec-shimmer_1.8s_linear_infinite]" />
                      <div className="relative flex items-center">
                        <span className="font-medium text-foreground/80">Working</span>
                        <span className="mx-1.5">•</span>
                        <span className="font-mono">{workingElapsedLabel}</span>
                        <span className="ml-2 inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-pulse" />
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:140ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:280ms]" />
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div aria-hidden className="h-6" />
                )}
              </div>
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
