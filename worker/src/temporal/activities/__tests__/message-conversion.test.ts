import { describe, it, expect } from 'bun:test';
import { convertToModelMessages } from 'ai';

describe('convertToModelMessages round-trip', () => {
  it('should produce valid model messages from a single assistant UIMessage with tool + text parts', async () => {
    // This is the CORRECT format: single assistant message with all parts merged
    const messages = [
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Show me available security workflows' }],
      },
      {
        role: 'assistant' as const,
        parts: [
          {
            type: 'dynamic-tool' as const,
            state: 'output-available' as const,
            toolName: 'list_workflows',
            toolCallId: 'call_77c457f9657d43b8b730d6a6',
            input: {},
            output: JSON.stringify({
              workflows: [
                { name: 'HTTP GET Request', description: 'Simple GET request', version: 'v1' },
              ],
            }),
          },
          {
            type: 'text' as const,
            text: 'Here are the available workflows in your organization.',
          },
        ],
      },
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'show me list of components' }],
      },
    ];

    const result = await convertToModelMessages(messages as any, {
      ignoreIncompleteToolCalls: true,
    });

    console.log('=== SINGLE assistant msg (correct format) ===');
    console.log(JSON.stringify(result, null, 2));

    // Should have: user, assistant(tool-call + text), tool(result), user
    expect(result.length).toBe(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[2].role).toBe('tool');
    expect(result[3].role).toBe('user');

    // The assistant message should have both tool-call and text
    const assistantContent = result[1].content as any[];
    const hasToolCall = assistantContent.some((p: any) => p.type === 'tool-call');
    const hasText = assistantContent.some((p: any) => p.type === 'text');
    expect(hasToolCall).toBe(true);
    expect(hasText).toBe(true);

    // Tool-call should have input
    const toolCall = assistantContent.find((p: any) => p.type === 'tool-call');
    expect(toolCall.input).toBeDefined();

    // Tool result should have output
    const toolResult = (result[2].content as any[])[0];
    expect(toolResult.output).toBeDefined();
    expect(toolResult.output.value).not.toBeNull();
  });

  it('should produce bad model messages from TWO separate assistant UIMessages (old buggy format)', async () => {
    // This is the OLD BUGGY format: two separate assistant messages
    const messages = [
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Show me available security workflows' }],
      },
      {
        role: 'assistant' as const,
        parts: [
          {
            type: 'dynamic-tool' as const,
            state: 'output-available' as const,
            toolName: 'list_workflows',
            toolCallId: 'call_77c457f9657d43b8b730d6a6',
            // Missing input and output - like the DB had
          },
        ],
      },
      {
        role: 'assistant' as const, // SEPARATE assistant message for text
        parts: [
          {
            type: 'text' as const,
            text: 'Here are the available workflows.',
          },
        ],
      },
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'show me list of components' }],
      },
    ];

    const result = await convertToModelMessages(messages as any, {
      ignoreIncompleteToolCalls: true,
    });

    console.log('=== TWO separate assistant msgs (old buggy format) ===');
    console.log(JSON.stringify(result, null, 2));

    // This produces: user, assistant(tool-call), tool(null result), assistant(text), user
    // The assistant(text) after tool(null result) is problematic for some LLMs
    expect(result.length).toBe(5); // 5 messages instead of 4!

    // Check tool result has null output
    const toolMsg = result.find((m: any) => m.role === 'tool');
    const toolResult = (toolMsg!.content as any[])[0];
    console.log('Tool result output:', JSON.stringify(toolResult.output));
    // This is the problem - null output
  });
});
