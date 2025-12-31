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
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message';
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning';
import { MessageResponse } from '@/components/ai-elements/message';
import { useState, useRef, useEffect } from 'react';

interface TemplateUpdate {
  template: string;
  inputSchema: Record<string, unknown>;
  sampleData: Record<string, unknown>;
  description: string;
}

interface TemplateChatProps {
  onUpdateTemplate?: (update: TemplateUpdate) => void;
  systemPrompt?: string;
}

/**
 * Template Chat Component - AI SDK v6 compatible with Tools
 */
export function TemplateChat({ onUpdateTemplate, systemPrompt }: TemplateChatProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track processed tool calls to avoid duplicates and ensure exactly one result per call
  const [processedToolCallIds] = useState(new Set<string>());

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
  }, [messages, onUpdateTemplate, addToolResult, processedToolCallIds, status]);

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
            <div key={`tool-${i}`} className="flex items-center gap-2 mt-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-600 animate-pulse">
              <WrenchIcon className="w-3.5 h-3.5" />
              <span>Generating template...</span>
            </div>
          );
        } else if (isDone) {
          elements.push(
            <div key={`tool-${i}`} className="flex items-center gap-2 mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
              <WrenchIcon className="w-3.5 h-3.5" />
              <span>✓ Template updated in preview</span>
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
    <div className="flex flex-col h-full bg-white border-t border-gray-100 font-sans">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-8">
            <div className="w-12 h-12 rounded-2xl bg-purple-50 flex items-center justify-center border border-purple-100">
              <SparklesIcon className="w-6 h-6 text-purple-600" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-gray-900">AI Template Assistant</h3>
              <p className="text-xs text-gray-500 max-w-[240px]">
                Describe your report template and I'll generate the HTML, schema, and sample data for you.
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
                  className="text-left px-3 py-2 text-[11px] text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
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
              <Message key={message.id} from={message.role}>
                <div className={cn(
                  "flex gap-3",
                  isUser ? "flex-row-reverse" : "flex-row"
                )}>
                  <div className={cn(
                    "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center shadow-sm",
                    isUser ? "bg-blue-600 text-white" : "bg-purple-600 text-white"
                  )}>
                    {isUser ? <UserIcon className="w-4 h-4" /> : <BotIcon className="w-4 h-4" />}
                  </div>

                  <div className="flex flex-col gap-2 max-w-[85%]">
                    <MessageContent className={cn(
                      "shadow-sm",
                      isUser
                        ? "bg-blue-600 text-white border-blue-700"
                        : "bg-gray-50 text-gray-800 border-gray-200"
                    )}>
                      {isUser ? textContent : renderMessageContent(message)}
                    </MessageContent>

                    {!isUser && textContent && (
                      <MessageActions className="px-1">
                        <MessageAction
                          tooltip="Copy to clipboard"
                          onClick={() => handleCopy(textContent, message.id)}
                        >
                          {copiedId === message.id ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <CopyIcon className="w-3.5 h-3.5" />}
                        </MessageAction>
                      </MessageActions>
                    )}
                  </div>
                </div>
              </Message>
            );
          })
        )}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center text-white shadow-sm">
              <BotIcon className="w-4 h-4" />
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 shadow-sm">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Section */}
      <div className="p-4 bg-gray-50/50 border-t border-gray-100">
        <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Describe your template..."
            rows={1}
            disabled={isLoading}
            className="flex-1 min-h-[44px] max-h-32 px-4 py-3 bg-white text-sm rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all disabled:opacity-50 resize-none shadow-sm"
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
                ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                : "bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 disabled:shadow-none"
            )}
          >
            {isLoading ? <StopCircleIcon className="w-5 h-5" /> : <SendIcon className="w-5 h-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
