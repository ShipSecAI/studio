'use client';

import { useState, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Loader } from '@/components/ai-elements/loader';
import { buildApiUrl, getApiAuthHeaders } from '@/services/api';

interface TemplateChatProps {
  onInsertTemplate?: (template: string) => void;
  systemPrompt?: string;
}

// Helper to get text content from UIMessage
const getMessageContent = (message: UIMessage) => {
  return message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');
};

export function TemplateChat({ onInsertTemplate, systemPrompt }: TemplateChatProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const transport = useMemo(() => new DefaultChatTransport({
    prepareSendMessagesRequest: async ({ body, headers }) => {
      const authHeaders = await getApiAuthHeaders();
      return {
        api: buildApiUrl('/api/v1/ai'),
        body: {
          ...(body ?? {}),
          ...(systemPrompt ? { systemPrompt } : {}),
          context: 'template',
        },
        headers: {
          ...headersInitToRecord(headers),
          ...authHeaders,
        },
      };
    },
    prepareReconnectToStreamRequest: async ({ headers }) => {
      const authHeaders = await getApiAuthHeaders();
      return {
        api: buildApiUrl('/api/v1/ai'),
        headers: {
          ...headersInitToRecord(headers),
          ...authHeaders,
        },
      };
    },
  }), [systemPrompt]);

  const {
    messages,
    sendMessage,
    status,
    stop,
  } = useChat({
    transport,
    onFinish: ({ message }) => {
      setIsGenerating(false);
      const content = getMessageContent(message);
      if (message.role === 'assistant' && onInsertTemplate && content) {
        onInsertTemplate(content);
      }
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    setIsGenerating(true);
    await sendMessage({
      role: 'user',
      parts: [{ type: 'text', text: inputValue }],
    });
    setInputValue('');
  };

  return (
    <div className="flex flex-col h-full">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                AI Template Generator
              </h3>
              <p className="text-sm text-gray-500 max-w-sm">
                Describe the report template you want to create, and AI will generate it for you.
              </p>
            </div>
          )}

          {messages.map((message, index) => {
            const content = getMessageContent(message);
            return (
              <Message key={index} from={message.role}>
                <MessageContent>
                  <div className="whitespace-pre-wrap">
                    {content}
                  </div>
                  {message.role === 'assistant' && onInsertTemplate && content && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => onInsertTemplate(content)}
                        className="px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                      >
                        Insert Template
                      </button>
                    </div>
                  )}
                </MessageContent>
              </Message>
            );
          })}

          {isGenerating && (
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2">
                  <Loader />
                  <span className="text-sm text-gray-500">Generating template...</span>
                </div>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
      </Conversation>

      <div className="border-t border-gray-200 p-4 bg-white">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Describe your report template..."
            disabled={status === 'streaming' || status === 'submitted'}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {status === 'streaming' || status === 'submitted' ? (
            <button
              type="button"
              onClick={stop}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Generate
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function headersInitToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }
  return { ...(headers as Record<string, string>) };
}
