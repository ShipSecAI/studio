'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { generateId } from 'ai';
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageUser,
  MessageAssistant,
  MessageResponse,
  MessageLoading,
} from '@/components/ai-elements/message';
import { Reasoning } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputActions,
  PromptInputAction,
} from '@/components/ai-elements/prompt-input';
import { Loader } from '@/components/ai-elements/loader';

interface TemplateChatProps {
  onInsertTemplate?: (template: string) => void;
  systemPrompt?: string;
}

export function TemplateChat({ onInsertTemplate, systemPrompt }: TemplateChatProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    stop,
    reload,
  } = useChat({
    api: '/api/templates/generate',
    body: { systemPrompt },
    onFinish: (message) => {
      setIsGenerating(false);
      if (message.role === 'assistant' && onInsertTemplate) {
        const textContent = message.content;
        onInsertTemplate(textContent);
      }
    },
  });

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setIsGenerating(true);
    await handleSubmit(e);
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

          {messages.map((message, index) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.role === 'user' ? (
                  <MessageUser>
                    <div className="prose prose-sm max-w-none">
                      {message.content}
                    </div>
                  </MessageUser>
                ) : (
                  <MessageAssistant>
                    {message.parts.map((part, partIndex) => {
                      switch (part.type) {
                        case 'text':
                          return (
                            <MessageResponse key={partIndex}>
                              <div className="prose prose-sm max-w-none whitespace-pre-wrap">
                                {part.text}
                              </div>
                            </MessageResponse>
                          );
                        case 'reasoning':
                          return (
                            <Reasoning
                              key={partIndex}
                              variant="compact"
                            >
                              {part.text}
                            </Reasoning>
                          );
                        default:
                          return null;
                      }
                    })}

                    {message.role === 'assistant' && onInsertTemplate && (
                      <div className="mt-3 flex gap-2">
                        <PromptInputAction
                          onClick={() => onInsertTemplate(message.content)}
                          disabled={!message.content}
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                            />
                          </svg>
                          Insert Template
                        </PromptInputAction>
                      </div>
                    )}
                  </MessageAssistant>
                )}
              </MessageContent>
            </Message>
          ))}

          {isGenerating && (
            <Message from="assistant">
              <MessageContent>
                <MessageLoading>
                  <div className="flex items-center gap-2">
                    <Loader />
                    <span className="text-sm text-gray-500">Generating template...</span>
                  </div>
                </MessageLoading>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
      </Conversation>

      <div className="border-t border-gray-200 p-4 bg-white">
        <form onSubmit={handleFormSubmit}>
          <PromptInput
            value={input}
            onChange={handleInputChange}
            placeholder="Describe your report template..."
            disabled={status === 'streaming' || status === 'submitted'}
          >
            <PromptInputTextarea />
            <PromptInputActions>
              {status === 'streaming' || status === 'submitted' ? (
                <PromptInputAction onClick={stop}>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
                    />
                  </svg>
                  Stop
                </PromptInputAction>
              ) : (
                <PromptInputSubmit
                  disabled={!input.trim() || status === 'loading'}
                />
              )}
            </PromptInputActions>
          </PromptInput>
        </form>
      </div>
    </div>
  );
}
