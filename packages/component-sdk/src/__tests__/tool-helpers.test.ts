import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  isAgentCallable,
  inferBindingType,
  getCredentialInputIds,
  getActionInputIds,
  getExposedParameterIds,
  getToolInputShape,
  getToolSchema,
  getToolName,
  getToolDescription,
  getToolMetadata,
} from '../tool-helpers';
import { inputs, outputs, port, param, parameters } from '../schema-builders';
import { extractPorts } from '../zod-ports';
import type { ComponentDefinition, ComponentPortMetadata } from '../types';

// Helper to create a minimal component definition
function createComponent(
  overrides: Partial<ComponentDefinition<any, any, any>> = {}
): ComponentDefinition<any, any, any> {
  return {
    id: 'test.component',
    label: 'Test Component',
    category: 'security',
    runner: { kind: 'inline' },
    inputs: inputs({}),
    outputs: outputs({}),
    docs: 'Test component documentation',
    execute: async () => ({}),
    ...overrides,
  };
}

describe('tool-helpers', () => {
  describe('isAgentCallable', () => {
    it('returns false when toolProvider is not configured', () => {
      const component = createComponent();
      expect(isAgentCallable(component)).toBe(false);
    });

    // Note: Component is callable if it has a toolProvider defined
    it('returns true when toolProvider is configured', () => {
      const component = createComponent({
        toolProvider: {
          kind: 'component',
          name: 'test_tool',
          description: 'Test Tool Description',
        },
      });
      expect(isAgentCallable(component)).toBe(true);
    });
  });

  describe('inferBindingType', () => {
    it('returns explicit bindingType when set', () => {
      const portWithExplicit: ComponentPortMetadata = {
        id: 'test',
        label: 'Test',
        connectionType: { kind: 'primitive', name: 'text' },
        bindingType: 'config',
      };
      expect(inferBindingType(portWithExplicit)).toBe('config');
    });

    it('infers credential for secret ports', () => {
      const secretPort: ComponentPortMetadata = {
        id: 'apiKey',
        label: 'API Key',
        connectionType: { kind: 'primitive', name: 'secret' },
      };
      expect(inferBindingType(secretPort)).toBe('credential');
    });

    it('infers credential for contract ports with credential flag', () => {
      const contractPort: ComponentPortMetadata = {
        id: 'awsCreds',
        label: 'AWS Credentials',
        connectionType: { kind: 'contract', name: 'aws', credential: true },
      };
      expect(inferBindingType(contractPort)).toBe('credential');
    });

    it('infers action for text ports', () => {
      const textPort: ComponentPortMetadata = {
        id: 'target',
        label: 'Target',
        connectionType: { kind: 'primitive', name: 'text' },
      };
      expect(inferBindingType(textPort)).toBe('action');
    });

    it('infers action for number ports', () => {
      const numberPort: ComponentPortMetadata = {
        id: 'count',
        label: 'Count',
        connectionType: { kind: 'primitive', name: 'number' },
      };
      expect(inferBindingType(numberPort)).toBe('action');
    });
  });

  describe('getCredentialInputIds', () => {
    it('returns IDs of credential inputs', () => {
      const component = createComponent({
        inputs: inputs({
          apiKey: port(z.string(), { label: 'API Key', editor: 'secret' }),
          target: port(z.string(), { label: 'Target' }),
          awsCreds: port(z.any(), { label: 'AWS', isCredential: true, schemaName: 'aws', allowAny: true }),
        }),
      });
      const credIds = getCredentialInputIds(component);
      expect(credIds).toEqual(['apiKey', 'awsCreds']);
    });
  });

  describe('getActionInputIds', () => {
    it('returns IDs of action inputs', () => {
      const component = createComponent({
        inputs: inputs({
          apiKey: port(z.string(), { label: 'API Key', editor: 'secret' }),
          target: port(z.string(), { label: 'Target' }),
          count: port(z.number(), { label: 'Count' }),
        }),
      });
      expect(getActionInputIds(component)).toEqual(['target', 'count']);
    });
  });

  describe('getToolSchema', () => {
    it('returns schema with action inputs only', () => {
      const component = createComponent({
        inputs: inputs({
          apiKey: port(z.string(), { label: 'API Key', editor: 'secret' }),
          ipAddress: port(z.string(), { label: 'IP Address', description: 'IP to check' }),
          verbose: port(z.boolean().default(false), { label: 'Verbose' }),
        }),
      });

      const schema = getToolSchema(component);

      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties!)).toEqual(['ipAddress', 'verbose']);
      expect(schema.properties!.ipAddress).toEqual({
        type: 'string',
        description: 'IP to check',
      });
      // Zod's toJSONSchema() correctly includes default values - this is better for MCP tools
      expect(schema.properties!.verbose).toEqual({
        type: 'boolean',
        description: 'Verbose',
        default: false,
      });
      // Note: Zod's toJSONSchema marks fields with defaults as required
      // (the default is applied at runtime, not by JSON Schema)
      expect(schema.required).toEqual(['ipAddress', 'verbose']);
    });

    it('includes exposed parameters in tool schema', () => {
      const component = createComponent({
        inputs: inputs({
          apiKey: port(z.string(), { label: 'API Key', editor: 'secret' }),
          url: port(z.string(), { label: 'URL' }),
        }),
        parameters: parameters({
          timeoutMs: param(z.number().min(100).default(2000), {
            label: 'Timeout (ms)',
            editor: 'number',
            exposeToTool: true,
          }),
          apiSecret: param(z.string(), {
            label: 'API Secret',
            editor: 'secret',
            exposeToTool: true,
          }),
        }),
      });

      const schema = getToolSchema(component);

      expect(Object.keys(schema.properties!)).toEqual(['url', 'timeoutMs']);
      expect(schema.properties!.timeoutMs).toMatchObject({
        type: 'number',
        default: 2000,
        minimum: 100,
        description: 'Timeout (ms)',
      });
    });
  });

  describe('getToolInputShape', () => {
    it('returns Zod shape with action inputs only', () => {
      const component = createComponent({
        inputs: inputs({
          apiKey: port(z.string(), { label: 'API Key', editor: 'secret' }),
          url: port(z.string(), { label: 'URL' }),
          count: port(z.number().optional(), { label: 'Count' }),
        }),
      });

      const shape = getToolInputShape(component);
      const shapeKeys = Object.keys(shape);

      expect(shapeKeys).toEqual(['url', 'count']);

      const parsed = z.object(shape).safeParse({ url: 'https://example.com' });
      expect(parsed.success).toBe(true);
    });

    it('includes exposed parameters in input shape', () => {
      const component = createComponent({
        inputs: inputs({
          target: port(z.string(), { label: 'Target' }),
        }),
        parameters: parameters({
          mode: param(z.enum(['fast', 'safe']).default('fast'), {
            label: 'Mode',
            editor: 'select',
            exposeToTool: true,
          }),
        }),
      });

      const shape = getToolInputShape(component);
      expect(Object.keys(shape)).toEqual(['target', 'mode']);
      const parsed = z.object(shape).safeParse({ target: 'example.com', mode: 'safe' });
      expect(parsed.success).toBe(true);
    });
  });

  describe('getExposedParameterIds', () => {
    it('returns only parameters marked exposeToTool', () => {
      const component = createComponent({
        parameters: parameters({
          mode: param(z.string().default('fast'), {
            label: 'Mode',
            editor: 'select',
            exposeToTool: true,
          }),
          token: param(z.string(), {
            label: 'Token',
            editor: 'secret',
            exposeToTool: true,
          }),
        }),
      });

      expect(getExposedParameterIds(component)).toEqual(['mode']);
    });
  });

  describe('getToolName', () => {
    it('uses agentTool.toolName when specified', () => {
      const component = createComponent({
        toolProvider: {
          kind: 'component',
          name: 'check_ip_reputation',
          description: 'IP reputation and abuse report lookup (AbuseIPDB).',
        },
      });
      expect(getToolName(component)).toBe('check_ip_reputation');
    });

    it('derives from slug when toolName not specified', () => {
      const component = createComponent({
        ui: {
          slug: 'abuseipdb-lookup',
          version: '1.0.0',
          type: 'process',
          category: 'security',
        },
        toolProvider: {
          kind: 'component',
          name: '',
          description: '',
        },
      });
      expect(getToolName(component)).toBe('abuseipdb_lookup');
    });
  });

  describe('getToolMetadata', () => {
    it('returns complete tool metadata for MCP', () => {
      const component = createComponent({
        ui: {
          slug: 'abuseipdb-lookup',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          description: 'Look up IP reputation',
        },
        toolProvider: {
          kind: 'component',
          name: 'check_ip_reputation',
          description: 'Check if an IP address is malicious',
        },
        inputs: inputs({
          apiKey: port(z.string(), { label: 'API Key', editor: 'secret' }),
          ipAddress: port(z.string(), { label: 'IP Address' }),
        }),
      });

      const metadata = getToolMetadata(component);

      expect(metadata.name).toBe('check_ip_reputation');
      expect(metadata.description).toBe('Check if an IP address is malicious');
      expect(metadata.inputSchema.properties).toHaveProperty('ipAddress');
      expect(metadata.inputSchema.properties).not.toHaveProperty('apiKey');
    });
  });
});
