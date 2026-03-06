import { describe, expect, it } from 'bun:test';

import { extractToolErrorDetails } from '../tool';

describe('extractToolErrorDetails', () => {
  it('keeps the generic summary while surfacing MCP text as details', () => {
    const result = extractToolErrorDetails(
      {
        content: [
          {
            type: 'text',
            text: 'Error: Failed query: SELECT * FROM workflow_versions',
          },
        ],
        isError: true,
      },
      undefined,
    );

    expect(result.summary).toBe('Tool execution failed');
    expect(result.details).toBe('Error: Failed query: SELECT * FROM workflow_versions');
  });

  it('does not duplicate details when the explicit error text already matches', () => {
    const result = extractToolErrorDetails(
      {
        content: [
          {
            type: 'text',
            text: 'Permission denied',
          },
        ],
        isError: true,
      },
      'Permission denied',
    );

    expect(result.summary).toBe('Permission denied');
    expect(result.details).toBeUndefined();
  });
});
