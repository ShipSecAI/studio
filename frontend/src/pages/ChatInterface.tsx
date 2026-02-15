import { useState, useEffect, useCallback, useMemo } from 'react';
import { Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { ChatCommandPalette, WorkflowPreviewPanel, SuggestedPrompts } from '@/components/chat';
import { useChatStore } from '@/store/chatStore';
import { useAuth } from '@/auth/auth-context';
import { useSidebar } from '@/components/layout/sidebar-context';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolOrDynamicToolUIPart } from 'ai';
import type { UIMessage } from 'ai';
import { getApiAuthHeaders } from '@/services/api';

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

// Get time-based greeting
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

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
}

function ChatMessageItem({ message, isStreaming }: ChatMessageProps) {
  const isAssistant = message.role === 'assistant';
  const hasContent = message.parts.some(
    (p) => (p.type === 'text' && p.text) || isToolOrDynamicToolUIPart(p),
  );
  const isEmptyAssistant = isAssistant && !hasContent;

  return (
    <Message from={message.role} className="max-w-full">
      <MessageContent>
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
                            errorText={'errorText' in part ? (part.errorText as string) : undefined}
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
  );
}

// Empty state component
interface EmptyStateProps {
  userName: string;
  onSelectPrompt: (prompt: string) => void;
}

function EmptyState({ userName, onSelectPrompt }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 min-h-0">
      {/* Plan Badge */}
      <div className="mb-8 animate-in fade-in-0 slide-in-from-top-4 duration-500">
        <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
          Free plan &middot;{' '}
          <Link to="/upgrade" className="ml-1 text-primary hover:text-primary/80 transition-colors">
            Upgrade
          </Link>
        </span>
      </div>

      {/* Greeting */}
      <h1 className="text-3xl md:text-4xl font-serif text-center mb-3 text-foreground font-medium tracking-tight animate-in fade-in-0 slide-in-from-bottom-4 duration-500 delay-100">
        <span className="inline-flex items-center gap-2.5">
          <Sparkles className="w-8 h-8 md:w-10 md:h-10 text-orange-500" />
          <span>
            {getGreeting()}, {userName}
          </span>
        </span>
      </h1>

      <p className="text-base text-muted-foreground mb-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 delay-200">
        How can I help you today?
      </p>

      {/* Suggested Prompts */}
      <div className="w-full max-w-2xl animate-in fade-in-0 slide-in-from-bottom-4 duration-500 delay-300">
        <SuggestedPrompts onSelectPrompt={onSelectPrompt} variant="pills" />
      </div>
    </div>
  );
}

// Main Chat Interface
export function ChatInterface() {
  const { user } = useAuth();
  const {
    sessions,
    currentSessionId,
    createSession,
    updateSessionTitle,
    getCurrentSession,
    setCommandPaletteOpen,
  } = useChatStore();

  const currentSession = getCurrentSession();

  // Create transport with auth headers
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        prepareSendMessagesRequest: async ({ body, headers, messages: msgs, id }) => {
          const authHeaders = await getApiAuthHeaders();
          return {
            api: '/api/v1/chat',
            body: { ...body, id, messages: msgs },
            headers: { ...headersInitToRecord(headers), ...authHeaders },
          };
        },
      }),
    [],
  );

  // useChat hook — connected to the backend streaming endpoint
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: chatTransport,
    id: currentSessionId ?? undefined,
  });

  // Auto-create session if none exists
  useEffect(() => {
    if (sessions.length === 0) {
      createSession();
    }
  }, [sessions.length, createSession]);

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

  // Handle submit from PromptInput
  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text?.trim();
      if (!text) return;
      sendMessage({ text });
    },
    [sendMessage],
  );

  const { isOpen: sidebarOpen, toggle: toggleSidebar } = useSidebar();

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Header with sidebar toggle */}
      <div className="h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center px-4 gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          className="h-9 w-9 flex-shrink-0"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
        </Button>
        <h1 className="text-lg font-semibold flex-1">ShipSec AI</h1>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {messages.length === 0 ? (
          <EmptyState userName={getUserName(user)} onSelectPrompt={handleSelectPrompt} />
        ) : (
          <Conversation className="flex-1">
            <ConversationContent className="max-w-3xl mx-auto gap-6 px-4 py-6 md:px-6">
              {messages.map((msg, idx) => (
                <ChatMessageItem
                  key={msg.id}
                  message={msg}
                  isStreaming={
                    status === 'streaming' &&
                    msg.role === 'assistant' &&
                    idx === messages.length - 1
                  }
                />
              ))}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}

        {/* Error display */}
        {error && (
          <div className="shrink-0 px-4">
            <div className="max-w-3xl mx-auto mb-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              {error.message || 'An error occurred while generating a response.'}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="shrink-0 p-4 md:pb-6 border-t bg-background">
          <div className="max-w-3xl mx-auto space-y-3">
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
                <PromptInputSubmit status={status} onStop={stop} />
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
