import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { MarkdownView as Markdown } from '@/components/ui/markdown';
import { ChatCommandPalette, WorkflowPreviewPanel, SuggestedPrompts } from '@/components/chat';
import { useChatStore, type ChatMessage } from '@/store/chatStore';
import { useAuth } from '@/auth/auth-context';
import { useSidebar } from '@/components/layout/sidebar-context';

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

// Message component
interface ChatMessageProps {
  message: ChatMessage;
}

function ChatMessageItem({ message }: ChatMessageProps) {
  const isAssistant = message.role === 'assistant';
  const isLoading = message.metadata?.isLoading;

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
          <span className="text-[10px] text-muted-foreground/70">
            {new Date(message.timestamp).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </span>
        </div>

        <div className="text-[15px] leading-relaxed text-foreground">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          ) : (
            <Markdown
              content={message.content}
              className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-muted prose-pre:border prose-pre:border-border/50 prose-pre:rounded-md prose-pre:p-3 prose-code:text-primary prose-headings:text-foreground prose-a:text-primary prose-strong:text-foreground"
            />
          )}
        </div>

        {message.metadata?.error && (
          <div className="mt-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
            {message.metadata.error}
          </div>
        )}
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
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { user } = useAuth();
  const {
    sessions,
    currentSessionId,
    createSession,
    addMessage,
    updateMessage,
    getCurrentSession,
    setCommandPaletteOpen,
  } = useChatStore();

  const currentSession = getCurrentSession();
  const messages = currentSession?.messages ?? [];

  // Auto-create session if none exists
  useEffect(() => {
    if (sessions.length === 0) {
      createSession();
    }
  }, [sessions.length, createSession]);

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
    (e?: React.FormEvent) => {
      e?.preventDefault();

      const trimmedInput = input.trim();
      if (!trimmedInput || !currentSessionId) return;

      // Add user message
      addMessage(currentSessionId, {
        role: 'user',
        content: trimmedInput,
      });

      setInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }

      // Add loading assistant message
      addMessage(currentSessionId, {
        role: 'assistant',
        content: '',
        metadata: { isLoading: true },
      });

      // Simulate AI response (replace with actual API call)
      setIsTyping(true);
      setTimeout(() => {
        // Get the last message and update it
        const session = useChatStore.getState().sessions.find((s) => s.id === currentSessionId);
        const lastMessage = session?.messages[session.messages.length - 1];

        if (lastMessage && lastMessage.role === 'assistant') {
          updateMessage(currentSessionId, lastMessage.id, {
            content: generateMockResponse(trimmedInput),
            metadata: { isLoading: false },
          });
        }
        setIsTyping(false);
      }, 1500);
    },
    [input, currentSessionId, addMessage, updateMessage],
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
              {messages.map((msg) => (
                <ChatMessageItem key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
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

                    {/* Send button */}
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!input.trim() || isTyping}
                      className={cn(
                        'h-9 w-9 rounded-lg transition-all duration-200',
                        input.trim() && !isTyping
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                          : 'bg-muted text-muted-foreground cursor-not-allowed',
                      )}
                    >
                      {isTyping ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowUp className="h-4 w-4" />
                      )}
                    </Button>
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

// Mock response generator (replace with actual API integration)
function generateMockResponse(input: string): string {
  const lowerInput = input.toLowerCase();

  if (lowerInput.includes('workflow')) {
    return `I'd be happy to help you with workflows! 🚀

Here's what I can do for you:

1. **Create a new workflow** - Guide you through building an automation step by step
2. **Explain workflow concepts** - Help you understand how nodes, edges, and data flow work
3. **Debug existing workflows** - Help identify and fix issues in your current workflows

Here's a simple workflow visualization:

\`\`\`mermaid
graph LR
    A[Start] --> B{Check Input}
    B -->|Valid| C[Process Data]
    B -->|Invalid| D[Show Error]
    C --> E[Save Result]
    E --> F[End]
    D --> F
\`\`\`

What would you like to explore first?`;
  }

  if (lowerInput.includes('code') || lowerInput.includes('example')) {
    return `Here's an example of how to make an API call in JavaScript:

\`\`\`javascript
async function fetchWorkflows() {
  try {
    const response = await fetch('/api/workflows', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${token}\`
      }
    });
    
    if (!response.ok) {
      throw new Error(\`HTTP error! status: \${response.status}\`);
    }
    
    const data = await response.json();
    return data.workflows;
  } catch (error) {
    console.error('Failed to fetch workflows:', error);
    throw error;
  }
}
\`\`\`

You can also use Python:

\`\`\`python
import requests

def fetch_workflows(api_key: str) -> list:
    """Fetch all workflows from the API."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(
        "https://api.shipsec.io/v1/workflows",
        headers=headers
    )
    response.raise_for_status()
    return response.json()["workflows"]
\`\`\`

Let me know if you want more examples!`;
  }

  if (lowerInput.includes('diagram') || lowerInput.includes('mermaid')) {
    return `Here are some Mermaid diagram examples:

### Sequence Diagram
\`\`\`mermaid
sequenceDiagram
    participant User
    participant API
    participant Database
    
    User->>API: Create Workflow
    API->>Database: Save Workflow
    Database-->>API: Confirmation
    API-->>User: Success Response
\`\`\`

### Flowchart
\`\`\`mermaid
flowchart TD
    A[Start] --> B{Is it working?}
    B -- Yes --> C[Great!]
    B -- No --> D[Debug]
    D --> B
    C --> E[Deploy]
\`\`\`

You can use these in your documentation or workflow descriptions!`;
  }

  if (lowerInput.includes('help') || lowerInput.includes('what can you do')) {
    return `I'm ShipSec AI, your automation assistant! 🤖

Here are some things I can help you with:

- **Build Workflows** - Create powerful automation pipelines
- **Write Code** - Generate scripts and code snippets
- **Debug Issues** - Help troubleshoot problems
- **Learn Concepts** - Explain how ShipSec works
- **Best Practices** - Share tips for effective automation

Just ask me anything, or type \`/\` to see available commands!`;
  }

  return `Thanks for your message! I'm currently in demo mode. 

In the full version, I'll be connected to the ShipSec backend to:
- Execute workflows
- Generate code
- Analyze your automation needs
- Provide real-time assistance

Try asking me about:
- \`code examples\` - See syntax-highlighted code blocks
- \`workflow\` - View workflow diagrams
- \`diagram\` or \`mermaid\` - See Mermaid visualizations

For now, feel free to explore the interface and try different commands using \`/\` or \`⌘K\`.`;
}
