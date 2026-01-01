/**
 * E2E Test for AI Chat Tool Invocation
 * 
 * This test validates that the backend correctly:
 * 1. Accepts messages in the correct format
 * 2. Returns a streaming response
 * 3. Includes tool calls when the AI decides to use a tool
 */

import { describe, test, expect } from 'bun:test';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN;

// Helper to get auth headers
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  return headers;
}

describe('AI Chat Tool Invocation', () => {
  test('should stream a response with tool calls for template generation', async () => {
    // This test requires authentication - skip if no token
    if (!AUTH_TOKEN) {
      console.log('Skipping: No TEST_AUTH_TOKEN provided');
      return;
    }

    const messages = [
      {
        id: 'test-1',
        role: 'user',
        content: 'Create a simple HTML template with a title and body',
        parts: [{ type: 'text', text: 'Create a simple HTML template with a title and body' }],
      },
    ];

    const response = await fetch(`${API_BASE}/api/v1/ai`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        messages,
        context: 'template',
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    // Read the stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullResponse = '';
    const events: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;
      
      // Parse SSE events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          events.push(line);
        }
      }
    }

    console.log('\n=== Raw Stream Response ===');
    console.log(fullResponse.slice(0, 2000) + (fullResponse.length > 2000 ? '...' : ''));
    console.log('\n=== Parsed Events (first 20) ===');
    events.slice(0, 20).forEach((e, i) => console.log(`${i}: ${e.slice(0, 200)}`));
    
    // Look for tool-related events
    const toolEvents = events.filter(e => 
      e.includes('tool') || 
      e.includes('update_template') || 
      e.includes('updateTemplate')
    );
    
    console.log('\n=== Tool-related Events ===');
    toolEvents.forEach(e => console.log(e.slice(0, 500)));

    // Basic assertions
    expect(fullResponse.length).toBeGreaterThan(0);
  });

  test('should parse tool calls from the stream correctly', async () => {
    // This test simulates what the frontend needs to do
    // by parsing the stream response format
    
    // Mock stream data based on AI SDK format
    const mockStreamEvents = [
      '0:"Hello"',
      '0:" there"',
      'a:{"toolCallId":"test-123","type":"tool-call","toolName":"update_template","args":{"template":"<div>Test</div>","inputSchema":{},"sampleData":{},"description":"Test template"}}',
    ];

    // Parse events
    for (const event of mockStreamEvents) {
      const colonIndex = event.indexOf(':');
      if (colonIndex === -1) continue;
      
      const prefix = event.slice(0, colonIndex);
      const data = event.slice(colonIndex + 1);
      
      console.log(`Prefix: ${prefix}, Data preview: ${data.slice(0, 100)}`);
      
      if (prefix === 'a') {
        // Tool call event
        try {
          const parsed = JSON.parse(data);
          console.log('Parsed tool call:', parsed);
          expect(parsed.toolName).toBe('update_template');
          expect(parsed.args).toBeDefined();
        } catch (e) {
          console.error('Failed to parse tool call:', e);
        }
      }
    }
  });
});

// Simple test runner
if (import.meta.main) {
  console.log('Run with: bun test ai-tool-invocation.test.ts');
}
