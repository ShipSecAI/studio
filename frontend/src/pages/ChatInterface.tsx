import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Plus,
  Sparkles,
  Paperclip,
  ArrowUp,
  Command,
  Bot,
  User,
  ChevronDown,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { MarkdownView as Markdown } from '@/components/ui/markdown';
import { ChatCommandPalette, WorkflowPreviewPanel, SuggestedPrompts } from '@/components/chat';
import { useChatStore } from '@/store/chatStore';
import { useAuth } from '@/auth/auth-context';
import { useSidebar } from '@/components/layout/sidebar-context';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolOrDynamicToolUIPart, getToolOrDynamicToolName } from 'ai';
import type { UIMessage } from 'ai';
import { getApiAuthHeaders, API_V1_URL } from '@/services/api';

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

// Message component
interface ChatMessageProps {
  message: UIMessage;
  isStreaming: boolean;
}

function ChatMessageItem({ message, isStreaming }: ChatMessageProps) {
  const isAssistant = message.role === 'assistant';
  const text = getMessageText(message);
  const toolParts = message.parts.filter(isToolOrDynamicToolUIPart);
  const isEmptyAssistant = isAssistant && !text && toolParts.length === 0;

  return (
    <div
      className={cn(
        'group flex gap-3 md:gap-4 py-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300',
        isAssistant ? 'bg-muted/30 rounded-lg px-4 -mx-4 py-2' : '',
      )}
    >
      {/* Avatar */}
      <Avatar
        className={cn(
          'h-8 w-8 shrink-0 ring-1 ring-border/30',
          isAssistant
            ? 'bg-gradient-to-br from-orange-500/20 to-orange-600/10'
            : 'bg-gradient-to-br from-primary/20 to-primary/5',
        )}
      >
        {isAssistant ? (
          <AvatarFallback className="bg-transparent">
            <Sparkles className="h-4 w-4 text-orange-500" />
          </AvatarFallback>
        ) : (
          <AvatarFallback className="bg-transparent text-primary">
            <User className="h-4 w-4" />
          </AvatarFallback>
        )}
      </Avatar>

      {/* Message Content */}
      <div className="flex-1 space-y-1.5 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'font-medium text-sm',
              isAssistant ? 'text-orange-600 dark:text-orange-400' : 'text-primary',
            )}
          >
            {isAssistant ? 'ShipSec AI' : 'You'}
          </span>
        </div>

        <div className="text-[15px] leading-relaxed text-foreground">
          {isEmptyAssistant && isStreaming ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          ) : (
            <>
              {/* Tool invocation parts */}
              {toolParts.map((part, idx) => {
                const toolName = getToolOrDynamicToolName(part);
                const isInProgress =
                  part.state === 'input-streaming' || part.state === 'input-available';
                const isDone = part.state === 'output-available';
                const isError = part.state === 'output-error';

                return (
                  <div
                    key={part.toolCallId ?? idx}
                    className="my-2 px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm"
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Wrench className="h-3.5 w-3.5" />
                      <span className="font-medium">{toolName}</span>
                      {isInProgress ? <Loader2 className="h-3 w-3 animate-spin ml-auto" /> : null}
                      {isDone ? (
                        <span className="ml-auto text-xs text-green-600 dark:text-green-400">
                          Done
                        </span>
                      ) : null}
                      {isError ? (
                        <span className="ml-auto text-xs text-destructive">Error</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {/* Text content */}
              {text && (
                <Markdown
                  content={text}
                  className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-muted prose-pre:border prose-pre:border-border/50 prose-pre:rounded-md prose-pre:p-3 prose-code:text-primary prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground"
                />
              )}

              {/* Streaming cursor for assistant */}
              {isAssistant && isStreaming && text && (
                <span className="inline-block w-1.5 h-4 bg-orange-500 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
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
          Free plan ·{' '}
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
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
        prepareSendMessagesRequest: async ({ body, headers }) => {
          const authHeaders = await getApiAuthHeaders();
          return {
            api: `${API_V1_URL}/chat`,
            body: body ?? {},
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

  const isLoading = status === 'submitted' || status === 'streaming';

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

  // Scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  // Handle prompt selection
  const handleSelectPrompt = useCallback((prompt: string) => {
    setInput(prompt + ' ');
    inputRef.current?.focus();
  }, []);

  // Send message
  const handleSendMessage = useCallback(
    (e?: { preventDefault(): void }) => {
      e?.preventDefault();

      const trimmedInput = input.trim();
      if (!trimmedInput || isLoading) return;

      sendMessage({ text: trimmedInput });
      setInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
    },
    [input, isLoading, sendMessage],
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }

      // Open command palette on /
      if (e.key === '/' && input === '') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    },
    [handleSendMessage, input, setCommandPaletteOpen],
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
          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 scrollbar-thin scrollbar-thumb-border">
            <div className="max-w-3xl mx-auto divide-y divide-border/30">
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
              <div ref={messagesEndRef} />
            </div>
          </div>
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
          <div className="max-w-3xl mx-auto space-y-4">
            {/* Input Container */}
            <div className="relative rounded-xl bg-muted/50 border border-border/60 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 shadow-sm transition-all duration-200">
              <form onSubmit={handleSendMessage} className="flex flex-col">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Message ShipSec... (Type / for commands)"
                  rows={1}
                  className="w-full bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 min-h-[56px] max-h-[200px] px-4 py-3 text-base text-foreground placeholder:text-muted-foreground resize-none scrollbar-thin scrollbar-thumb-border/50"
                  autoFocus
                />

                {/* Bottom toolbar */}
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setCommandPaletteOpen(true)}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg"
                    >
                      <Command className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Model selector */}
                    <button className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-accent hover:bg-accent/80 px-2.5 py-1.5 rounded-lg transition-colors">
                      <Bot className="h-3.5 w-3.5" />
                      <span>ShipSec AI</span>
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </button>

                    {/* Stop / Send button */}
                    {isLoading ? (
                      <Button
                        type="button"
                        size="icon"
                        onClick={stop}
                        className="h-9 w-9 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm transition-all duration-200"
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!input.trim()}
                        className={cn(
                          'h-9 w-9 rounded-lg transition-all duration-200',
                          input.trim()
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                            : 'bg-muted text-muted-foreground cursor-not-allowed',
                        )}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </div>

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
