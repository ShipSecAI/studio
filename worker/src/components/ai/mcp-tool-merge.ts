import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  withPortMeta,
} from '@shipsec/component-sdk';
import { McpToolDefinitionSchema } from '@shipsec/contracts';

const inputSchema = inputs({});

const parameterSchema = parameters({
  slots: param(
    z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
        }),
      )
      .default([
        { id: 'toolsA', label: 'Tools A' },
        { id: 'toolsB', label: 'Tools B' },
      ])
      .describe('Configure which upstream tool lists should be merged.'),
    {
      label: 'Inputs',
      editor: 'json',
      description: 'Array of input definitions. Example: [{"id":"toolsA","label":"Tools A"}].',
    },
  ),
});

const outputSchema = outputs({
  tools: port(z.array(McpToolDefinitionSchema()), {
    label: 'Merged Tools',
    description: 'Combined MCP tool list with duplicates removed by id.',
  }),
});

const definition = defineComponent({
  id: 'core.mcp.tools.merge',
  label: 'MCP Tool Merge',
  category: 'ai',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Merge multiple MCP tool lists into a single list for the AI agent.',
  ui: {
    slug: 'mcp-tools-merge',
    version: '0.1.0',
    type: 'process',
    category: 'ai',
    description: 'Combine multiple MCP tool providers into a single list.',
    icon: 'Merge',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const slots = normalizeSlots(params.slots);
    const inputShape: Record<string, z.ZodTypeAny> = {};
    for (const slot of slots) {
      inputShape[slot.id] = withPortMeta(z.array(McpToolDefinitionSchema()), {
        label: slot.label,
      });
    }

    return {
      inputs: inputs(inputShape),
      outputs: outputs({
        tools: port(z.array(McpToolDefinitionSchema()), {
          label: 'Merged Tools',
        }),
      }),
    };
  },
  async execute({ inputs, params }, context) {
    const slots = normalizeSlots(params.slots);
    const merged: Record<string, z.infer<ReturnType<typeof McpToolDefinitionSchema>>> = {};

    for (const slot of slots) {
      const value = (inputs as Record<string, unknown>)[slot.id];
      if (Array.isArray(value)) {
        for (const entry of value) {
          const parsed = McpToolDefinitionSchema().safeParse(entry);
          if (parsed.success) {
            merged[parsed.data.id] = parsed.data;
          }
        }
      }
    }

    const tools = Object.values(merged);
    context.logger.info(
      `[McpToolMerge] Merged ${tools.length} MCP tool${tools.length === 1 ? '' : 's'}.`,
    );

    return { tools };
  },
});

function normalizeSlots(
  slotsInput: z.infer<typeof parameterSchema>['slots'],
): { id: string; label: string }[] {
  const fallback = [
    { id: 'toolsA', label: 'Tools A' },
    { id: 'toolsB', label: 'Tools B' },
  ];
  if (!Array.isArray(slotsInput) || slotsInput.length === 0) {
    return fallback;
  }
  const slots = slotsInput
    .map((slot) => {
      const id = typeof slot?.id === 'string' ? slot.id.trim() : '';
      if (!id) {
        return null;
      }
      return {
        id,
        label: typeof slot?.label === 'string' && slot.label.trim().length > 0 ? slot.label : id,
      };
    })
    .filter((slot): slot is { id: string; label: string } => slot !== null);

  return slots.length > 0 ? slots : fallback;
}

componentRegistry.register(definition);
