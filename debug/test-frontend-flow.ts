#!/usr/bin/env bun
/**
 * Test that simulates EXACTLY what useChat sends to the backend
 * 
 * This tests the full HTTP flow to understand what format comes back
 * and how the frontend should parse it.
 * 
 * Run: bun run scripts/test-frontend-flow.ts
 */

import { streamText, tool, convertToModelMessages } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

// The EXACT format that DefaultChatTransport sends
interface FrontendRequest {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    parts: Array<{ type: 'text'; text: string }>;
    createdAt?: string;
  }>;
  systemPrompt?: string;
  context?: string;
  model?: string;
}

const API_URL = 'http://localhost:3211/api/v1/ai';

// Simulate what the frontend sends
const frontendPayload: FrontendRequest = {
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Create a simple table template with 3 columns',
      parts: [{ type: 'text', text: 'Create a simple table template with 3 columns' }],
    },
  ],
  context: 'template',
};

async function testWithAuth() {
  console.log('=== Testing Frontend → Backend Flow ===\n');
  console.log('Request URL:', API_URL);
  
  // Basic Auth admin:admin
  const authHeader = `Basic ${Buffer.from('admin:admin').toString('base64')}`;
  console.log('Using Basic Auth: admin:admin');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(frontendPayload),
    });

    console.log('\nResponse status:', response.status);
    
    if (response.status === 401 || response.status === 404) {
      console.log(`\n⚠️  Status ${response.status}. Testing AI SDK directly with GLM...\n`);
      return testDirectly();
    }

    if (!response.ok) {
      const text = await response.text();
      console.error('Error response:', text);
      return;
    }

    await parseSSEStream(response);
  } catch (error) {
    console.error('Fetch error:', error);
    console.log('\n⚠️  Backend error. Testing AI SDK directly with GLM...\n');
    return testDirectly();
  }
}

async function parseSSEStream(response: Response) {
  console.log('\n=== Parsing SSE Stream ===\n');
  
  const reader = response.body?.getReader();
  if (!reader) {
    console.error('No response body');
    return;
  }

  const decoder = new TextDecoder();
  const events: Array<{ type: string; data: any }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data:')) continue;
      
      const jsonStr = line.slice(5).trim();
      try {
        const data = JSON.parse(jsonStr);
        events.push({ type: data.type, data });
        
        if (data.type?.includes('tool')) {
          console.log('Tool Event:', JSON.stringify(data, null, 2));
        }
      } catch (e) {}
    }
  }

  console.log('\nEvent types received:', events.map(e => e.type));
  
  const toolAvailable = events.find(e => e.type === 'tool-input-available');
  if (toolAvailable) {
    console.log('\n✓ Tool invocation found!');
    console.log('  - toolName:', toolAvailable.data.toolName);
    console.log('  - input keys:', Object.keys(toolAvailable.data.input || {}));
  }
}

async function testDirectly() {
  console.log('=== Testing GLM-4.5-Air via OpenRouter Directly ===\n');
  
  const client = createOpenAI({ 
    apiKey: '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',
    baseURL: 'https://openrouter.ai/api/v1',
  });

  const model = client('z-ai/glm-4.5-air');

  const modelMessages = await convertToModelMessages(frontendPayload.messages as any);

  const result = await streamText({
    model,
    system: `You are a template generation expert. When asked to create a template, 
             you MUST use the update_template tool to output the HTML template.`,
    messages: modelMessages,
    tools: {
      update_template: tool({
        description: 'Update the template editor',
        inputSchema: z.object({
          template: z.string().describe('HTML template'),
          inputSchema: z.record(z.string(), z.any()).describe('JSON Schema'),
          sampleData: z.record(z.string(), z.any()).describe('Sample data'),
          description: z.string().describe('Description'),
        }),
      }),
    },
  });

  const streamResponse = result.toUIMessageStreamResponse();
  console.log('\n=== Stream Response From GLM ===\n');
  
  await parseSSEStream(streamResponse as unknown as Response);

  console.log('\n=== Native Stream Fragments ===\n');
  for await (const chunk of result.fullStream) {
    if (chunk.type.includes('tool')) {
      console.log('Chunk:', JSON.stringify(chunk, null, 2));
    }
  }
}

testWithAuth().catch(console.error);
