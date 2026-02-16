import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Search,
  AlertTriangle,
  Play,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChatCommandPalette, WorkflowPreviewPanel } from '@/components/chat';
import { useChatStore } from '@/store/chatStore';
import { useAuth } from '@/auth/auth-context';
import { useSidebar } from '@/components/layout/sidebar-context';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolOrDynamicToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import { StatusBar } from '@/components/agent/StatusBar';

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

// Helper to convert HeadersInit to Record<string, string>
function headersInitToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as Record<string, string>;
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
                    return (
                      <Tool key={toolId}>
                        <ToolHeader
                          type={part.type as 'tool-invocation'}
                          state={part.state}
                          title={
                            'toolName' in part
                              ? (part.toolName as string)
                              : part.type.split('-').slice(1).join('-')
                          }
                        />
                        <ToolContent>
                          {'input' in part && part.input !== undefined && (
                            <ToolInput input={part.input} />
                          )}
                          {(part.state === 'output-available' || part.state === 'output-error') &&
                            'output' in part && (
                              <ToolOutput
                                output={part.output}
                                errorText={
                                  'errorText' in part ? (part.errorText as string) : undefined
                                }
                              />
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
  const {
    currentSessionId,
    createSession,
    updateSessionTitle,
    getCurrentSession,
    setCommandPaletteOpen,
    loadSessions,
  } = useChatStore();

  const currentSession = getCurrentSession();

  // Ref to always have the latest sessionId available in the transport callback
  const sessionIdRef = useRef(currentSessionId);
  sessionIdRef.current = currentSessionId;

  // Load sessions from server on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Create transport with auth headers — uses ref so it always reads the latest session ID
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        prepareSendMessagesRequest: async ({ body, headers, messages: msgs, id }) => {
          const authHeaders = await getApiAuthHeaders();
          return {
            api: `${API_V1_URL}/chat/sessions/${sessionIdRef.current}/messages`,
            body: { ...body, id, messages: msgs },
            headers: { ...headersInitToRecord(headers), ...authHeaders },
          };
        },
      }),

    [],
  );

  // Load messages for current session
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [messagesKey, setMessagesKey] = useState(0);

  useEffect(() => {
    if (!currentSessionId) {
      setInitialMessages([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const authHeaders = await getApiAuthHeaders();
        const res = await fetch(`${API_V1_URL}/chat/sessions/${currentSessionId}/messages`, {
          headers: { ...authHeaders },
        });
        if (!res.ok || cancelled) return;
        const msgs = await res.json();
        if (!cancelled) {
          setInitialMessages(
            msgs.map((m: any) => ({
              id: m.id,
              role: m.role,
              parts: m.parts,
              createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
            })),
          );
          setMessagesKey((k) => k + 1);
        }
      } catch {
        // ignore fetch errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  // useChat hook — connected to the backend streaming endpoint
  // chatId changes on session switches but NOT during lazy creation within the same conversation
  const isLazyCreationRef = useRef(false);
  const [chatId, setChatId] = useState(() =>
    currentSessionId ? `${currentSessionId}-0` : `chat-${Date.now()}`,
  );

  useEffect(() => {
    if (!currentSessionId) {
      // User clicked "New Conversation" — reset chat to empty state
      setChatId(`new-${Date.now()}`);
      setInitialMessages([]);
    } else if (isLazyCreationRef.current) {
      // Skip — lazy creation just happened, don't reset useChat
      isLazyCreationRef.current = false;
    } else {
      // Session loaded from server or user switched sessions
      setChatId(`${currentSessionId}-${messagesKey}`);
    }
  }, [currentSessionId, messagesKey]);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: chatTransport,
    id: chatId,
    messages: initialMessages,
  });

  // Auto-update session title from first user message
  useEffect(() => {
    if (
      currentSession &&
      currentSession.title === 'New Conversation' &&
      currentSessionId &&
      messages.length > 0
    ) {
      const firstUserMsg = messages.find((m) => m.role === 'user');
      if (firstUserMsg) {
        const text = getMessageText(firstUserMsg);
        if (text) {
          const title = text.slice(0, 50) + (text.length > 50 ? '...' : '');
          updateSessionTitle(currentSessionId, title);
        }
      }
    }
  }, [messages, currentSession, currentSessionId, updateSessionTitle]);

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
        const title = text.slice(0, 50) + (text.length > 50 ? '...' : '');
        isLazyCreationRef.current = true;
        const newSessionId = await createSession(title);
        sessionIdRef.current = newSessionId;
      }

      sendMessage({ text });
    },
    [sendMessage, createSession],
  );

  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar();
  const userImageUrl = (user as { imageUrl?: string } | null)?.imageUrl;

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Header: sidebar toggle + StatusBar */}
      <div className="flex items-center h-11 border-b bg-background/60 backdrop-blur-sm">
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
        <StatusBar className="flex-1 border-b-0" />
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {messages.length === 0 ? (
          <EmptyState userName={getUserName(user)} onSelectPrompt={handleSelectPrompt} />
        ) : (
          <Conversation className="flex-1">
            <ConversationContent className="max-w-5xl mx-auto gap-6 px-4 py-6 md:px-8">
              {messages.map((msg, idx) => (
                <ChatMessageItem
                  key={msg.id}
                  message={msg}
                  isStreaming={
                    status === 'streaming' &&
                    msg.role === 'assistant' &&
                    idx === messages.length - 1
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
                  <PromptInputButton tooltip="Commands" onClick={() => setCommandPaletteOpen(true)}>
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
                  <PromptInputSubmit status={status} onStop={stop} />
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

      {/* Command Palette */}
      <ChatCommandPalette onSelectPrompt={handleSelectPrompt} />

      {/* Workflow Preview Panel */}
      <WorkflowPreviewPanel />
    </div>
  );
}
