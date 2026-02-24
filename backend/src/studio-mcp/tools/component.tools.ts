import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Ensure all worker components are registered before accessing the registry
import '@shipsec/studio-worker/components';
import {
  componentRegistry,
  extractPorts,
  isAgentCallable,
  getToolSchema,
  type CachedComponentMetadata,
} from '@shipsec/component-sdk';
import { categorizeComponent } from '../../components/utils/categorization';
import { errorResult } from './types';

export function registerComponentTools(server: McpServer): void {
  server.registerTool(
    'list_components',
    {
      description:
        'List all available workflow components (nodes) with their category, description, and whether they are agent-callable.',
    },
    async () => {
      try {
        const entries = componentRegistry.listMetadata();
        const components = entries.map((entry: CachedComponentMetadata) => {
          const def = entry.definition;
          const category = categorizeComponent(def);
          return {
            id: def.id,
            name: def.label,
            category,
            description: def.ui?.description ?? def.docs ?? '',
            runner: def.runner?.kind ?? 'inline',
            agentCallable: isAgentCallable(def),
            inputCount: (entry.inputs ?? []).length,
            outputCount: (entry.outputs ?? []).length,
          };
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(components, null, 2) }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_component',
    {
      description:
        'Get detailed information about a specific component, including its full input/output/parameter schemas.',
      inputSchema: { componentId: z.string() },
    },
    async (args: { componentId: string }) => {
      try {
        const entry = componentRegistry.getMetadata(args.componentId);
        if (!entry) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Component "${args.componentId}" not found`,
              },
            ],
            isError: true,
          };
        }
        const def = entry.definition;
        const category = categorizeComponent(def);
        const result = {
          id: def.id,
          name: def.label,
          category,
          description: def.ui?.description ?? def.docs ?? '',
          documentation: def.docs ?? null,
          runner: def.runner,
          inputs: entry.inputs ?? extractPorts(def.inputs),
          outputs: entry.outputs ?? extractPorts(def.outputs),
          parameters: entry.parameters ?? [],
          agentCallable: isAgentCallable(def),
          toolSchema: isAgentCallable(def) ? getToolSchema(def) : null,
          examples: def.ui?.examples ?? [],
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
