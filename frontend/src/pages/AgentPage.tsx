import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Workflow, Shield, FileSearch, Zap, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useChatStore, type ChatMessage } from '@/store/chatStore';
import { useAuthProvider } from '@/auth/auth-context';

const suggestedActions = [
  {
    icon: Workflow,
    label: 'Run workflow',
    description: 'Execute a security workflow',
  },
  {
    icon: Shield,
    label: 'Scan repository',
    description: 'Analyze code for vulnerabilities',
  },
  {
    icon: FileSearch,
    label: 'Review findings',
    description: 'Check recent security findings',
  },
  {
    icon: Zap,
    label: 'Quick actions',
    description: 'Common security tasks',
  },
];

interface MessageBubbleProps {
  message: ChatMessage;
  userImageUrl?: string;
  userInitials?: string;
}

function MessageBubble({ message, userImageUrl, userInitials }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {/* Assistant avatar (left side) */}
      {!isUser && (
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src="/favicon.ico" alt="ShipSec AI" />
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">AI</AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-4 py-3',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        <span className="text-xs opacity-60 mt-1 block">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* User avatar (right side) */}
      {isUser && (
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={userImageUrl} alt="You" />
          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
            {userInitials || <User className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

function WelcomeScreen({ onSuggestedAction }: { onSuggestedAction: (action: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      {/* Logo and branding */}
      <div className="flex flex-col items-center mb-8">
        <div className="flex items-center gap-3 mb-4">
          <img
            src="/favicon.ico"
            alt="ShipSec"
            className="w-12 h-12"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div className="flex flex-col">
            <h1 className="text-3xl font-bold">ShipSec AI Agent</h1>
            <p className="text-sm text-muted-foreground">Your intelligent security assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
          <Sparkles className="w-3 h-3" />
          <span>Powered by Claude Opus</span>
        </div>
      </div>

      {/* Suggested actions */}
      <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
        {suggestedActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              onClick={() => onSuggestedAction(action.label)}
              className={cn(
                'flex flex-col items-start gap-2 p-4 rounded-xl border border-border',
                'bg-card hover:bg-accent transition-colors text-left',
                'group cursor-pointer',
              )}
            >
              <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-sm">{action.label}</p>
                <p className="text-xs text-muted-foreground">{action.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Metadata footer */}
      <div className="mt-8 text-center">
        <p className="text-xs text-muted-foreground">
          ShipSec AI can help you with security workflows, code scanning, and vulnerability
          management.
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Model: claude-opus-4-5-20251101 | Context: 200K tokens
        </p>
      </div>
    </div>
  );
}

export function AgentPage() {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const authProvider = useAuthProvider();
  const { user } = authProvider.context;

  // Get user avatar info
  const userImageUrl = user?.imageUrl;
  const userInitials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user?.username
        ? user.username.substring(0, 2).toUpperCase()
        : user?.email
          ? user.email.substring(0, 2).toUpperCase()
          : undefined;

  const { activeConversationId, createConversation, addMessage, getActiveConversation } =
    useChatStore();

  const activeConversation = getActiveConversation();
  const messages = activeConversation?.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    let conversationId = activeConversationId;
    if (!conversationId) {
      conversationId = createConversation();
    }

    // Add user message
    addMessage(conversationId, {
      role: 'user',
      content: inputValue.trim(),
    });

    // Simulate agent response (echo "hello" back)
    const userMessage = inputValue.trim().toLowerCase();
    setTimeout(() => {
      let response =
        "Hello! I'm the ShipSec AI Agent. How can I assist you with your security workflows today?";

      if (
        userMessage.includes('hello') ||
        userMessage.includes('hi') ||
        userMessage.includes('hey')
      ) {
        response =
          "Hello! I'm ready to help you with security workflows, vulnerability scanning, and code analysis. What would you like to do?";
      } else if (userMessage.includes('run workflow')) {
        response =
          'I can help you run a security workflow. Which workflow would you like to execute? You can choose from:\n\n• Code Security Scan\n• Dependency Audit\n• Infrastructure Review\n• Compliance Check';
      } else if (userMessage.includes('scan')) {
        response =
          "I'll initiate a security scan for you. Please provide the repository URL or select from your connected repositories.";
      }

      addMessage(conversationId!, {
        role: 'assistant',
        content: response,
      });
    }, 500);

    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedAction = (action: string) => {
    setInputValue(action);
    // Focus the input
    textareaRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <WelcomeScreen onSuggestedAction={handleSuggestedAction} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                userImageUrl={userImageUrl}
                userInitials={userInitials}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message ShipSec AI..."
                rows={1}
                className={cn(
                  'w-full resize-none rounded-xl border border-input bg-background px-4 py-3',
                  'text-sm placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  'min-h-[48px] max-h-[200px]',
                )}
              />
            </div>
            <Button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              size="icon"
              className="h-12 w-12 rounded-xl flex-shrink-0"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            ShipSec AI may produce inaccurate information. Always verify security findings.
          </p>
        </div>
      </div>
    </div>
  );
}
