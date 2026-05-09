import { describe, expect, it } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import '../studio-mcp-group';

describe('studio MCP group component', () => {
  it('returns a remote Studio MCP attachment for workflow agents', async () => {
    const component: any = componentRegistry.get('mcp.group.studio');
    expect(component).toBeDefined();

    const output = await component.execute(
      {
        inputs: { apiKey: 'sk_live_test' },
        params: { backendOrigin: 'http://localhost:3000' },
      },
      {} as any,
    );

    expect(output.remoteMcpAttachments).toEqual([
      {
        alias: 'shipsec-studio',
        url: 'http://host.docker.internal:3000/api/v1/studio-mcp',
        headers: { Authorization: 'Bearer sk_live_test' },
      },
    ]);
    expect(output.tools[0].name).toBe('ShipSec Studio MCP');
  });
});
