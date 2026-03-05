import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
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
  StopCircle,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChatCommandPalette, WorkflowPreviewPanel } from '@/components/chat';
import { RunInspectorSidePanel } from '@/components/chat/RunInspectorSidePanel';
import { EmbeddedRunGraph } from '@/components/chat/EmbeddedRunGraph';
import { useExecutionRun } from '@/hooks/queries/useExecutionQueries';
import { useChatStore } from '@/store/chatStore';
import { useAuth } from '@/auth/auth-context';
import { useSidebar } from '@/components/layout/sidebar-context';
import { useDurableChat } from '@/lib/use-durable-chat';
import { isToolOrDynamicToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import { StatusBar } from '@/components/agent/StatusBar';
import { useToast } from '@/components/ui/use-toast';
import { DurableChatTransport, type ChatSessionStateResponse } from '@/lib/durable-chat-transport';

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

interface TurnStatusPayload {
  turnId?: string;
  status?: 'queued' | 'running' | 'stopping' | 'completed' | 'interrupted' | 'failed' | 'cancelled';
  reason?: string;
  preview?: string;
  queuedAt?: string;
  startedAt?: string;
  endedAt?: string;
  processingStatus?: 'idle' | 'processing' | 'stopping';
  activeRunId?: string | null;
  activeRunStartedAt?: string | null;
  afterSeq?: number;
  lastSeq?: number;
  seq?: number;
}

interface ConversationSeparatorItem {
  kind: 'separator';
  id: string;
  label: string;
  variant: 'interrupted' | 'compacted';
  snapshot?: string;
}

interface ConversationMessageItem {
  kind: 'message';
  id: string;
  message: UIMessage;
  index: number;
}

type ConversationRenderItem = ConversationSeparatorItem | ConversationMessageItem;

interface LocalSteerQueueItem {
  id: string;
  text: string;
}

function extractCompactionSnapshot(message: UIMessage): string | null {
  if (message.role !== 'system') return null;
  const text = getMessageText(message).trim();
  const marker = '[Conversation summary of earlier messages]';
  if (!text.startsWith(marker)) return null;
  const snapshot = text.slice(marker.length).trim();
  return snapshot.length > 0 ? snapshot : null;
}

function getTurnStatusChunkPayload(chunk: unknown): TurnStatusPayload | null {
  if (!chunk || typeof chunk !== 'object') {
    return null;
  }
  const typed = chunk as { type?: unknown; data?: unknown };
  if (typed.type !== 'data-turn-status') {
    return null;
  }
  if (typed.data && typeof typed.data === 'object') {
    return typed.data as TurnStatusPayload;
  }
  return typed as TurnStatusPayload;
}

// Memoized tool part — skips re-render when the part object reference hasn't changed.
// During streaming, text-delta updates create a new message but reuse the same part
// objects for completed tool calls, so this avoids re-rendering 50+ tool cards on
// every keystroke of the growing text response.
const ToolPartRenderer = memo(function ToolPartRenderer({ part, idx }: { part: any; idx: number }) {
  const toolId = part.toolCallId ?? `tool-${idx}`;
  const displayState =
    part.state === 'output-available' && 'preliminary' in part && part.preliminary === true
      ? 'input-available'
      : part.state;
  const partToolName = 'toolName' in part ? (part.toolName as string) : undefined;

  const parsedWorkflowRun =
    (part.state === 'output-available' || part.state === 'output-error') && 'output' in part
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
        {'input' in part && part.input !== undefined && <ToolInput input={part.input} />}
        {shouldRenderWorkflowRunCard && parsedWorkflowRun ? (
          <WorkflowRunStatusCard run={parsedWorkflowRun} />
        ) : (
          (part.state === 'output-available' || part.state === 'output-error') &&
          'output' in part && (
            <ToolOutput
              output={part.output}
              errorText={'errorText' in part ? (part.errorText as string) : undefined}
            />
          )
        )}
      </ToolContent>
    </Tool>
  );
});

// Message component using AI Elements
interface ChatMessageProps {
  message: UIMessage;
  isStreaming: boolean;
  userImageUrl?: string;
}

const ChatMessageItem = memo(
  function ChatMessageItem({ message, isStreaming, userImageUrl }: ChatMessageProps) {
    const isAssistant = message.role === 'assistant';
    const hasContent = message.parts.some(
      (p) => (p.type === 'text' && p.text) || isToolOrDynamicToolUIPart(p),
    );
    const isEmptyAssistant = isAssistant && !hasContent;

    return (
      <div
        className={`flex gap-3 ${isAssistant ? 'justify-start' : 'justify-end'}`}
        style={
          // Do not apply content-visibility to assistant messages.
          // Large markdown responses can otherwise remain blank while the browser defers paint.
          !isAssistant && !isStreaming
            ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }
            : undefined
        }
      >
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
                        <Reasoning
                          key={`reasoning-${idx}`}
                          isStreaming={part.state === 'streaming'}
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }

                    if (isToolOrDynamicToolUIPart(part)) {
                      const toolId = part.toolCallId ?? `tool-${idx}`;
                      return <ToolPartRenderer key={toolId} part={part} idx={idx} />;
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
  },
  (prev, next) => {
    // Skip re-render if the message identity and streaming state haven't changed.
    // During streaming only the last (streaming) message changes — all others
    // keep the same parts reference so this short-circuits the diff.
    if (prev.isStreaming !== next.isStreaming) return false;
    if (prev.message !== next.message) return false;
    if (prev.userImageUrl !== next.userImageUrl) return false;
    return true;
  },
);

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
    sessions,
    currentSessionId,
    createSession,
    startNewConversation,
    updateSessionTitle,
    setCommandPaletteOpen,
    loadSessions,
    setCurrentSession,
    newConversationToken,
    selectedRunId,
    isRunInspectorOpen,
  } = useChatStore(
    useShallow((state) => ({
      sessions: state.sessions,
      currentSessionId: state.currentSessionId,
      createSession: state.createSession,
      startNewConversation: state.startNewConversation,
      updateSessionTitle: state.updateSessionTitle,
      setCommandPaletteOpen: state.setCommandPaletteOpen,
      loadSessions: state.loadSessions,
      setCurrentSession: state.setCurrentSession,
      newConversationToken: state.newConversationToken,
      selectedRunId: state.selectedRunId,
      isRunInspectorOpen: state.isRunInspectorOpen,
    })),
  );
  const { data: selectedRunData } = useExecutionRun(selectedRunId);

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? null,
    [sessions, currentSessionId],
  );

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
  // Queue first message until the hook sees the new session id.
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

  const [sessionProcessing, setSessionProcessing] = useState(false);
  const [sessionProcessingStartedAtMs, setSessionProcessingStartedAtMs] = useState<number | null>(
    null,
  );

  // Create DurableChatTransport.
  const chatTransport = useMemo(
    () =>
      new DurableChatTransport({
        apiBase: API_V1_URL,
        getAuthHeaders: getApiAuthHeaders,
      }),
    [],
  );

  // ── useDurableChat: owns messages, SSE lifecycle, streaming buffer ──
  const { messages, sendMessage, refreshState, status, error } = useDurableChat({
    transport: chatTransport,
    sessionId: currentSessionId,
    onChunk: (chunk, context) => {
      const activeSessionId = routeSessionIdRef.current ?? sessionIdRef.current;
      if (activeSessionId && context.sessionId !== activeSessionId) return;

      const payload = getTurnStatusChunkPayload(chunk);
      if (!payload) return;
      if (payload.status === 'running' || payload.status === 'queued') {
        setSessionProcessing(true);
        if (payload.startedAt) {
          setSessionProcessingStartedAtMs(new Date(payload.startedAt).getTime());
        }
      }
      if (payload.status === 'stopping') {
        setSessionProcessing(true);
        setIsStopping(true);
      }
      if (
        payload.status === 'completed' ||
        payload.status === 'interrupted' ||
        payload.status === 'failed' ||
        payload.status === 'cancelled'
      ) {
        setIsStopping(false);
      }

      // Single source of truth for processing state comes from backend /state.
      // We refresh on lifecycle edges to avoid rebuilding queue state in the UI.
      if (payload.status) {
        void refreshState();
      }
    },
    onStateRefresh: (state) => {
      const isProcessing =
        state.processingStatus === 'processing' || state.processingStatus === 'stopping';
      setSessionProcessing(isProcessing);
      setIsStopping(state.processingStatus === 'stopping');
      setInterruptionBoundaries(state.interruptionBoundaries ?? []);
      setSessionProcessingStartedAtMs(
        state.activeRunStartedAt ? new Date(state.activeRunStartedAt).getTime() : null,
      );
    },
  });

  // Reset ChatInterface-specific state when starting a new conversation
  useEffect(() => {
    if (newConversationToken > 0 && !currentSessionId) {
      setSessionProcessing(false);
      setSessionProcessingStartedAtMs(null);
      setLocalSteerQueue([]);
      setPendingSteerDispatchText(null);
      setInterruptionBoundaries([]);
      isCreatingSessionRef.current = false;
    }
  }, [newConversationToken, currentSessionId]);

  // Reset local state on session switch
  useEffect(() => {
    if (routeSessionId === 'new') {
      setSessionProcessing(false);
      setSessionProcessingStartedAtMs(null);
      setLocalSteerQueue([]);
      setPendingSteerDispatchText(null);
      setInterruptionBoundaries([]);
      isCreatingSessionRef.current = false;
      sessionIdRef.current = null;
      return;
    }

    if (!currentSessionId) {
      setSessionProcessing(false);
      setSessionProcessingStartedAtMs(null);
      setLocalSteerQueue([]);
      setPendingSteerDispatchText(null);
      setInterruptionBoundaries([]);
      return;
    }

    // Session switch — clear ChatInterface-specific state; hook handles messages + SSE
    setSessionProcessing(false);
    setSessionProcessingStartedAtMs(null);
    setIsStopping(false);
    setLocalSteerQueue([]);
    setPendingSteerDispatchText(null);
    setInterruptionBoundaries([]);
  }, [currentSessionId, routeSessionId]);

  // Once the user switches away from the just-created session, clear the
  // marker so future visits hydrate from backend as usual.
  useEffect(() => {
    if (lazyCreatedSessionRef.current && currentSessionId !== lazyCreatedSessionRef.current) {
      lazyCreatedSessionRef.current = null;
    }
  }, [currentSessionId]);

  // NOTE: Previously had a useEffect to send queued first message when
  // currentSessionId changed. This was unreliable due to React StrictMode
  // double-firing effects. Now sendMessage is called directly from
  // handleSubmit with an explicit sessionId override.

  const isAgentWorking = status === 'streaming' || status === 'submitting' || sessionProcessing;
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

  // Auto-scroll: track if user is near bottom, scroll on new content
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // "Near bottom" = within 150px of the bottom
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Respect manual scroll-up during streaming; only stick to bottom if already near bottom.
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, status]);

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
  const [isStopping, setIsStopping] = useState(false);
  const [interruptionBoundaries, setInterruptionBoundaries] = useState<
    ChatSessionStateResponse['interruptionBoundaries']
  >([]);
  const [expandedCompactionIds, setExpandedCompactionIds] = useState<Set<string>>(new Set());
  const [steeringTurnId, setSteeringTurnId] = useState<string | null>(null);
  const [localSteerQueue, setLocalSteerQueue] = useState<LocalSteerQueueItem[]>([]);
  const [pendingSteerDispatchText, setPendingSteerDispatchText] = useState<string | null>(null);
  const handleSelectPrompt = useCallback((prompt: string) => {
    setPendingPrompt(prompt + ' ');
  }, []);

  const handleInterrupt = useCallback(async () => {
    if (!currentSessionId || isStopping) return;
    setIsStopping(true); // Optimistic — will be confirmed/cleared by SSE events
    try {
      await chatTransport.interruptGeneration(currentSessionId);
    } catch (err) {
      console.warn('Failed to interrupt generation:', err);
      setIsStopping(false);
    }
  }, [currentSessionId, isStopping, chatTransport]);

  const handleSteerQueue = useCallback(async () => {
    if (!currentSessionId || steeringTurnId || localSteerQueue.length === 0) return;
    setSteeringTurnId('all');
    setPendingSteerDispatchText(localSteerQueue.map((entry) => entry.text).join('\n\n'));
    try {
      await chatTransport.steerTurn(currentSessionId);
    } catch (err) {
      console.warn('Failed to steer turn:', err);
      toast({
        variant: 'destructive',
        title: 'Steer failed',
        description: 'Unable to steer to the queued messages.',
      });
      setPendingSteerDispatchText(null);
    } finally {
      setSteeringTurnId(null);
    }
  }, [currentSessionId, steeringTurnId, localSteerQueue, chatTransport, toast]);

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
          // Route transition is explicit to avoid relying on effect timing.
          navigate(`/chat/${newSessionId}`, { replace: true });
          // Send message directly with explicit sessionId — the ref-based
          // pendingFirstMessage effect is unreliable due to React StrictMode
          // double-firing effects which consumes the ref before the real run.
          sendMessage({ text, sessionId: newSessionId });
          return;
        } finally {
          isCreatingSessionRef.current = false;
        }
      }

      if (isAgentWorking || localSteerQueue.length > 0) {
        setLocalSteerQueue((prev) => [
          ...prev,
          {
            id: `local-steer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text,
          },
        ]);
        toast({
          title: 'Added to local steer queue',
          description: 'This message stays local until you click Steer Now.',
        });
        return;
      }
      setIsStopping(false);
      sendMessage({ text });
    },
    [sendMessage, createSession, navigate, isAgentWorking, localSteerQueue.length, toast],
  );

  useEffect(() => {
    if (!pendingSteerDispatchText || !currentSessionId) return;
    if (isAgentWorking) return;

    sendMessage({ text: pendingSteerDispatchText, sessionId: currentSessionId });
    setLocalSteerQueue([]);
    setPendingSteerDispatchText(null);
    setIsStopping(false);
  }, [pendingSteerDispatchText, currentSessionId, isAgentWorking, sendMessage]);

  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar();
  const userImageUrl = (user as { imageUrl?: string } | null)?.imageUrl;
  const displayQueuedTurns = useMemo(() => {
    return localSteerQueue.map((entry, index) => ({
      turnId: entry.id,
      preview: entry.text,
      queuePosition: index + 1,
      status: 'queued',
    }));
  }, [localSteerQueue]);
  const displayPendingCount = localSteerQueue.length;
  const conversationItems = useMemo<ConversationRenderItem[]>(() => {
    const items: ConversationRenderItem[] = [];
    const boundariesByIndex = new Map<number, string[]>();
    for (const boundary of interruptionBoundaries ?? []) {
      if (!boundary || typeof boundary.beforeMessageIndex !== 'number' || !boundary.turnId) {
        continue;
      }
      const idx = Math.max(0, Math.min(messages.length, boundary.beforeMessageIndex));
      const existing = boundariesByIndex.get(idx) ?? [];
      existing.push(boundary.turnId);
      boundariesByIndex.set(idx, existing);
    }

    for (let idx = 0; idx < messages.length; idx += 1) {
      const leadingBoundaries = boundariesByIndex.get(idx) ?? [];
      for (const turnId of leadingBoundaries) {
        items.push({
          kind: 'separator',
          id: `interrupt-${turnId}`,
          label: 'Conversation interrupted',
          variant: 'interrupted',
        });
      }

      const message = messages[idx];
      const compactionSnapshot = extractCompactionSnapshot(message);
      if (compactionSnapshot) {
        items.push({
          kind: 'separator',
          id: `compact-${message.id}`,
          label: 'Conversation compacted',
          variant: 'compacted',
          snapshot: compactionSnapshot,
        });
        continue;
      }

      items.push({
        kind: 'message',
        id: message.id,
        message,
        index: idx,
      });
    }

    const trailingBoundaries = boundariesByIndex.get(messages.length) ?? [];
    for (const turnId of trailingBoundaries) {
      items.push({
        kind: 'separator',
        id: `interrupt-${turnId}`,
        label: 'Conversation interrupted',
        variant: 'interrupted',
      });
    }
    return items;
  }, [messages, interruptionBoundaries]);

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

          {messages.length === 0 ? (
            <EmptyState userName={getUserName(user)} onSelectPrompt={handleSelectPrompt} />
          ) : (
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto"
            >
              <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-end gap-4 px-4 py-4 md:px-6">
                {conversationItems.map((item) => {
                  if (item.kind === 'separator') {
                    const isCompacted = item.variant === 'compacted';
                    const isExpanded = expandedCompactionIds.has(item.id);
                    return (
                      <div key={item.id} className="py-1">
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
                          <span
                            className={`rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide ${
                              isCompacted
                                ? 'border-primary/35 bg-primary/10 text-primary'
                                : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                            }`}
                          >
                            {item.label}
                          </span>
                          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-border to-border" />
                        </div>
                        {isCompacted && item.snapshot && (
                          <div className="mt-2 flex flex-col items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCompactionIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                })
                              }
                              className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                            >
                              {isExpanded ? 'Hide compact snapshot' : 'View compact snapshot'}
                            </button>
                            {isExpanded && (
                              <div className="w-full rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
                                {item.snapshot}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <ChatMessageItem
                      key={item.id}
                      message={item.message}
                      isStreaming={
                        (status === 'streaming' || sessionProcessing) &&
                        item.message.role === 'assistant' &&
                        item.index === messages.length - 1
                      }
                      userImageUrl={userImageUrl}
                    />
                  );
                })}
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

          {/* Input Area */}
          <div className="shrink-0 border-t bg-background/85 px-3 py-2 backdrop-blur-sm md:px-4 md:py-3">
            <div className="mx-auto max-w-5xl space-y-2">
              <div className="min-h-5">
                {isAgentWorking ? (
                  <div className="flex items-center gap-2 justify-start">
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
                    <button
                      className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-background px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                      onClick={handleInterrupt}
                      disabled={isStopping}
                    >
                      <StopCircle className="h-3 w-3" />
                      {isStopping ? 'Stopping...' : 'Stop'}
                    </button>
                  </div>
                ) : (
                  <div aria-hidden className="h-6" />
                )}
              </div>
              {displayPendingCount > 0 && (
                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground/80">
                      Steer Queue ({displayPendingCount})
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSteerQueue()}
                      disabled={Boolean(steeringTurnId) || localSteerQueue.length === 0}
                      className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
                    >
                      {steeringTurnId ? 'Steering...' : 'Steer Now'}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {displayQueuedTurns.map((turn, index) => {
                      const displayPosition = turn.queuePosition ?? index + 1;
                      const preview =
                        turn.preview?.trim() && turn.preview.trim().length > 0
                          ? turn.preview.trim()
                          : `Queued message ${displayPosition}`;
                      return (
                        <div
                          key={turn.turnId}
                          className="rounded-md border border-border/70 bg-background/70 px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] text-muted-foreground">
                              #{displayPosition} · {turn.status.toUpperCase()}
                            </div>
                            <div className="text-sm text-foreground break-words">{preview}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
                    <PromptInputSubmit
                      status={status === 'submitting' ? 'submitted' : status}
                      onStop={handleInterrupt}
                    />
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
