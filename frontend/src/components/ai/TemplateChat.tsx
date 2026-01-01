'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { buildApiUrl, getApiAuthHeaders } from '@/services/api';
import { cn } from '@/lib/utils';
import {
  SendIcon,
  SparklesIcon,
  StopCircleIcon,
  CopyIcon,
  CheckIcon,
  UserIcon,
  BotIcon,
  WrenchIcon,
} from 'lucide-react';
import {
  MessageAction,
} from '@/components/ai-elements/message';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning';
import { MessageResponse } from '@/components/ai-elements/message';
import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface TemplateUpdate {
  template: string;
  inputSchema: Record<string, unknown>;
  sampleData: Record<string, unknown>;
  description: string;
}

interface TemplateChatProps {
  onUpdateTemplate?: (update: TemplateUpdate) => void;
  onSavePreviousValues?: () => TemplateUpdate;
  onUndoTemplate?: (previousValues: TemplateUpdate) => void;
  systemPrompt?: string;
}

/**
 * Template Chat Component - AI SDK v6 compatible with Tools
 */
export function TemplateChat({ onUpdateTemplate, onSavePreviousValues, onUndoTemplate, systemPrompt }: TemplateChatProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track processed tool calls to avoid duplicates and ensure exactly one result per call
  const [processedToolCallIds] = useState(new Set<string>());

  // Track previous values for undo functionality
  const [previousValues, setPreviousValues] = useState<TemplateUpdate | null>(null);
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);

  const { messages, sendMessage, status, stop, addToolResult } = useChat({
    transport: new DefaultChatTransport({
      api: buildApiUrl('/api/v1/ai'),
      headers: async () => {
        const auth = await getApiAuthHeaders();
        return { ...auth } as Record<string, string>;
      },
      body: {
        systemPrompt,
        context: 'template',
      },
    }),
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  const handleConfirmUndo = () => {
    if (previousValues && onUndoTemplate) {
      onUndoTemplate(previousValues);
      setPreviousValues(null);
    }
    setShowUndoConfirm(false);
  };

  // Process tool invocations from messages
  useEffect(() => {
    if (!onUpdateTemplate) return;

    // Look for tool invocations in the latest assistant message
    const latestAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
    if (!latestAssistantMessage || !('parts' in latestAssistantMessage)) return;

    const parts = latestAssistantMessage.parts as Array<{
      type: string;
      toolName?: string;
      toolCallId?: string;
      state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
      input?: Record<string, unknown>;
      args?: Record<string, unknown>;
    }>;

    for (const part of parts) {
      const isUpdateTemplateToolPart = part.type === 'tool-update_template';
      const isStandardToolCall = (part.type === 'tool-call' || part.type === 'tool-invocation') &&
        (part.toolName === 'update_template' || part.toolName === 'updateTemplate');

      if (!isUpdateTemplateToolPart && !isStandardToolCall) continue;

      const toolInput = part.input || part.args;
      const toolCallId = part.toolCallId;

      const isInputPresent = !!toolInput;
      // We only finalize if we have the full input (available) or output (available)
      // We do NOT finalize on 'input-streaming' because that's for live preview only
      const isDone = part.state === 'input-available' || part.state === 'output-available' || status === 'ready';

      // 1. Handle Real-time Streaming Updates (Idempotent)
      if (isInputPresent && part.state === 'input-streaming' && status !== 'ready') {
        const args = toolInput as { template?: string; html?: string };
        const templateContent = args.template || args.html;
        if (templateContent) {
          onUpdateTemplate({
            template: templateContent,
            inputSchema: (toolInput as any).inputSchema || {},
            sampleData: (toolInput as any).sampleData || {},
            description: (toolInput as any).description || '',
          });
        }
      }

      // 2. Handle Final Tool Completion (Once per toolCallId)
      if (isInputPresent && isDone && toolCallId && !processedToolCallIds.has(toolCallId)) {
        const args = toolInput as {
          template?: string;
          html?: string;
          inputSchema?: Record<string, unknown>;
          sampleData?: Record<string, unknown>;
          description?: string;
        };

        const templateContent = args.template || args.html;

        if (templateContent) {
          // Save previous values for undo before updating
          if (onSavePreviousValues) {
            const prevValues = onSavePreviousValues();
            setPreviousValues(prevValues);
          }

          // Final update to ensure consistency
          onUpdateTemplate({
            template: templateContent,
            inputSchema: args.inputSchema || {},
            sampleData: args.sampleData || {},
            description: args.description || '',
          });

          // Acknowledge the tool call by adding a result to the history
          // This fixes validation errors on the next turn
          console.log(`✅ Acknowledging tool call ${toolCallId}`);
          addToolResult({
            toolCallId,
            tool: part.toolName || 'update_template',
            output: 'Template updated successfully in the editor.',
          });

          processedToolCallIds.add(toolCallId);
        }
      }
    }
  }, [messages, onUpdateTemplate, onSavePreviousValues, addToolResult, processedToolCallIds, status]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && status === 'ready') {
      sendMessage({ text: inputValue });
      setInputValue('');
    }
  };

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Helper to extract text content and tool info from message parts
  const renderMessageContent = (message: typeof messages[0]) => {
    if (!('parts' in message) || !Array.isArray(message.parts)) {
      return null;
    }

    const elements: React.ReactNode[] = [];

    for (let i = 0; i < message.parts.length; i++) {
      const part = message.parts[i] as any;

      if (part.type === 'text' && part.text) {
        elements.push(
          <MessageResponse key={`text-${i}`}>
            {part.text}
          </MessageResponse>
        );
      } else if (part.type === 'reasoning' || part.type === 'thought') {
        const isStreaming = status === 'streaming' &&
          i === message.parts.length - 1 &&
          message.id === messages[messages.length - 1].id;

        elements.push(
          <Reasoning key={`reasoning-${i}`} isStreaming={isStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>
              {part.reasoning || part.thought || (part as any).text || ''}
            </ReasoningContent>
          </Reasoning>
        );
      } else if (part.type === 'tool-update_template' ||
        ((part.type === 'tool-call' || part.type === 'tool-invocation') &&
          (part.toolName === 'update_template' || part.toolName === 'updateTemplate'))) {

        const isStreaming = part.state === 'input-streaming' && status !== 'ready';
        const isDone = part.state === 'input-available' || part.state === 'output-available' || status === 'ready';

        if (isStreaming) {
          elements.push(
            <div key={`tool-${i}`} className="flex items-center gap-2 mt-4 px-3 py-2 bg-purple-500/5 border border-purple-500/10 rounded-lg text-[11px] text-purple-500/80 animate-pulse w-fit">
              <WrenchIcon className="w-3 h-3" />
              <span className="font-medium">Updating template...</span>
            </div>
          );
        } else if (isDone) {
          const toolInput = part.input || part.args;
          const hasSchema = toolInput?.inputSchema && Object.keys(toolInput.inputSchema).length > 0;
          const hasSample = toolInput?.sampleData && Object.keys(toolInput.sampleData).length > 0;
          const hasTemplate = toolInput?.template || toolInput?.html;

          // Just show a simple success indicator - the actual data is visible in the sidebar tabs
          const updates: string[] = [];
          if (hasTemplate) updates.push('template');
          if (hasSchema) updates.push('schema');
          if (hasSample) updates.push('sample data');

          elements.push(
            <div key={`tool-${i}`} className="flex items-center gap-2 mt-3 px-3 py-2 bg-green-500/5 border border-green-500/10 rounded-lg text-[11px] text-green-500/80 w-fit">
              <WrenchIcon className="w-3 h-3" />
              <span className="font-medium">
                Updated {updates.join(', ')}
              </span>
              {previousValues && onUndoTemplate && (
                <button
                  onClick={() => setShowUndoConfirm(true)}
                  className="ml-2 px-2 py-0.5 bg-muted hover:bg-muted/80 rounded text-[10px] font-medium text-muted-foreground transition-colors"
                >
                  Undo
                </button>
              )}
            </div>
          );
        }
      }
    }

    return elements.length > 0 ? elements : null;
  };

  // Get text content for copy functionality
  const getMessageText = (message: typeof messages[0]): string => {
    if ('parts' in message && Array.isArray(message.parts)) {
      return message.parts
        .filter((part): part is { type: 'text'; text: string } =>
          typeof part === 'object' && part !== null && part.type === 'text' && 'text' in part
        )
        .map(part => part.text)
        .join('');
    }
    return '';
  };

  return (
    <div className="flex flex-col h-full bg-card font-sans">
      <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-10 overscroll-contain">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 py-8">
            <div className="w-16 h-16 rounded-3xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-inner">
              <SparklesIcon className="w-8 h-8 text-purple-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-foreground tracking-tight">AI Template Assistant</h3>
              <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                Describe your report template and I'll generate the HTML, schema, and sample data for you instantly.
              </p>
            </div>
            <div className="grid gap-2 w-full max-w-[280px]">
              {[
                'Pentest report with findings table',
                'Executive summary with severity chart',
                'Header with logo and client name',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setInputValue(suggestion)}
                  className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground bg-muted/40 hover:bg-accent hover:text-foreground rounded-xl border border-border/50 transition-all duration-200"
                >
                  "{suggestion}"
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === 'user';
            const textContent = getMessageText(message);

            return (
              <div key={message.id} className="group flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className={cn(
                  "flex items-center gap-3",
                  isUser ? "flex-row-reverse text-right" : "flex-row"
                )}>
                  <div className={cn(
                    "flex-shrink-0 w-6 h-6 rounded flex items-center justify-center shadow-sm",
                    isUser ? "bg-primary text-primary-foreground" : "bg-purple-600 text-white"
                  )}>
                    {isUser ? <UserIcon className="w-3 h-3" /> : <BotIcon className="w-3 h-3" />}
                  </div>

                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    {isUser ? "Question" : "ShipSec AI"}
                  </span>

                  {!isUser && textContent && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                      <MessageAction
                        tooltip="Copy"
                        onClick={() => handleCopy(textContent, message.id)}
                        className="h-6 w-6"
                      >
                        {copiedId === message.id ? <CheckIcon className="w-3 h-3 text-green-500" /> : <CopyIcon className="w-3 h-3" />}
                      </MessageAction>
                    </div>
                  )}
                </div>

                <div className={cn(
                  "text-sm leading-relaxed text-foreground/90 selection:bg-primary/20",
                  isUser ? "pr-9 text-right font-medium text-foreground" : "pl-9"
                )}>
                  {isUser ? textContent : renderMessageContent(message)}
                </div>
              </div>
            );
          })
        )}
        {isLoading && (() => {
          const lastMsg = messages[messages.length - 1];
          const hasContent = lastMsg?.role === 'assistant' && renderMessageContent(lastMsg);
          const label = hasContent ? 'Working' : 'Thinking';
          
          return (
            <div className="flex flex-col gap-3 pl-9 animate-in fade-in duration-500">
               <div className="flex items-center gap-1.5 p-2 w-fit rounded-lg bg-muted/30">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce"></span>
                  </span>
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider ml-1">{label}</span>
               </div>
            </div>
          );
        })()}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Section */}
      <div className="p-4 bg-muted/30 border-t border-border">
        <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Describe your template..."
            rows={1}
            disabled={isLoading}
            className="flex-1 min-h-[44px] max-h-32 px-4 py-3 bg-background text-foreground text-sm rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all disabled:opacity-50 resize-none shadow-sm placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <button
            type={isLoading ? "button" : "submit"}
            onClick={isLoading ? stop : undefined}
            disabled={!isLoading && !inputValue.trim()}
            className={cn(
              "p-3 rounded-xl transition-all shadow-md flex-shrink-0",
              isLoading
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20"
                : "bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 disabled:shadow-none"
            )}
          >
            {isLoading ? <StopCircleIcon className="w-5 h-5" /> : <SendIcon className="w-5 h-5" />}
          </button>
        </form>
      </div>

      {/* Undo Confirmation Dialog */}
      <Dialog open={showUndoConfirm} onOpenChange={setShowUndoConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Undo AI Changes?</DialogTitle>
            <DialogDescription>
              This will restore the template, schema, and sample data to their previous state before the AI update. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setShowUndoConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmUndo}
            >
              Undo Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
