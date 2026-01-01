#!/usr/bin/env bun
/**
 * Simple script to test AI SDK streaming with tools
 * 
 * This directly calls the AI service to understand the stream format
 * before it goes through HTTP.
 * 
 * Run: cd backend && bun run scripts/test-ai-tools.ts
 */

import { streamText, tool, type UIMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

// Get the model
const googleApiKey = process.env.GOOGLE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!googleApiKey && !openaiApiKey) {
  console.error('Please set GOOGLE_API_KEY or OPENAI_API_KEY');
  process.exit(1);
}

const model = googleApiKey 
  ? createGoogleGenerativeAI({ apiKey: googleApiKey })('gemini-2.5-flash')
  : createOpenAI({ apiKey: openaiApiKey })('gpt-4o-mini');

console.log('Using model:', googleApiKey ? 'gemini-2.5-flash' : 'gpt-4o-mini');

// Define the tool
const updateTemplateTool = tool({
  description: 'Update the template editor with generated template code',
  inputSchema: z.object({
    template: z.string().describe('The HTML template code'),
    inputSchema: z.record(z.string(), z.any()).describe('JSON Schema for inputs'),
    sampleData: z.record(z.string(), z.any()).describe('Sample data'),
    description: z.string().describe('Description of the template'),
  }),
});

// Test messages
const messages: UIMessage[] = [
  {
    id: '1',
    role: 'user',
    content: 'Create a simple table template with 3 columns',
    parts: [{ type: 'text', text: 'Create a simple table template with 3 columns' }],
  } as unknown as UIMessage,
];

async function testStreamText() {
  console.log('\n=== Testing streamText with tools ===\n');

  const result = await streamText({
    model,
    system: `You are a template generation expert. When asked to create a template, 
             you MUST use the update_template tool to output the HTML template.
             Do not output raw HTML in your response.`,
    messages: messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content || '',
    })),
    tools: {
      update_template: updateTemplateTool,
    },
  });

  console.log('1. Checking result object properties:');
  console.log('   - Has toUIMessageStreamResponse:', typeof result.toUIMessageStreamResponse === 'function');
  console.log('   - Has textStream:', typeof result.textStream !== 'undefined');
  
  console.log('\n2. toUIMessageStreamResponse() result:');
  const streamResponse = result.toUIMessageStreamResponse();
  console.log('   - Type:', typeof streamResponse);
  console.log('   - Has body:', !!streamResponse.body);
  console.log('   - Headers:', Object.fromEntries(streamResponse.headers.entries()));

  console.log('\n3. Reading the stream:');
  const reader = streamResponse.body?.getReader();
  if (!reader) {
    console.error('No body reader');
    return;
  }

  const decoder = new TextDecoder();
  let fullResponse = '';
  let eventCount = 0;
  const toolCalls: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    fullResponse += chunk;
    
    // Parse each line
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      eventCount++;
      
      // Check for tool-related content
      if (line.includes('tool') || line.includes('update_template') || line.includes('template')) {
        console.log(`   Event ${eventCount}: ${line.slice(0, 200)}${line.length > 200 ? '...' : ''}`);
      }
      
      // Try to parse as JSON if it looks like a tool call
      if (line.includes('tool-call') || line.includes('update_template')) {
        try {
          // Extract JSON after the prefix (e.g., "a:" or "d:")
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            const jsonPart = line.slice(colonIdx + 1);
            const parsed = JSON.parse(jsonPart);
            toolCalls.push(parsed);
          }
        } catch (e) {
          // Not JSON, that's ok
        }
      }
    }
  }

  console.log('\n4. Summary:');
  console.log('   - Total response length:', fullResponse.length);
  console.log('   - Total events:', eventCount);
  console.log('   - Tool calls found:', toolCalls.length);
  
  if (toolCalls.length > 0) {
    console.log('\n5. Tool Call Details:');
    toolCalls.forEach((tc, i) => {
      console.log(`\n   Tool Call ${i + 1}:`);
      console.log('   - Type:', tc.type);
      console.log('   - Tool Name:', tc.toolName);
      console.log('   - Has args:', !!tc.args);
      console.log('   - Has input:', !!tc.input);
      if (tc.args) {
        console.log('   - Args keys:', Object.keys(tc.args));
      }
      if (tc.input) {
        console.log('   - Input keys:', Object.keys(tc.input));
      }
    });
  }

  console.log('\n=== Raw response (first 3000 chars) ===');
  console.log(fullResponse.slice(0, 3000));
}

testStreamText().catch(console.error);
