import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  isAgentCallable,
  inferBindingType,
  getCredentialInputIds,
  getActionInputIds,
  getToolSchema,
  getToolName,
  getToolDescription,
  getToolMetadata,
} from '../tool-helpers';
import { port } from '../ports';
import type { ComponentDefinition, ComponentPortMetadata } from '../types';

// Helper to create a minimal component definition
function createComponent(
  overrides: Partial<ComponentDefinition> = {}
): ComponentDefinition {
  return {
    id: 'test.component',
    label: 'Test Component',
    category: 'security',
    runner: { kind: 'inline' },
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    docs: 'Test component documentation',
    execute: async () => ({}),
    ...overrides,
  };
}

describe('tool-helpers', () => {
  describe('isAgentCallable', () => {
    it('returns false when agentTool is not configured', () => {
      const component = createComponent();
      expect(isAgentCallable(component)).toBe(false);
    });

    it('returns false when agentTool.enabled is false', () => {
      const component = createComponent({
        metadata: {
          slug: 'test',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          agentTool: { enabled: false },
        },
      });
      expect(isAgentCallable(component)).toBe(false);
    });

    it('returns true when agentTool.enabled is true', () => {
      const component = createComponent({
        metadata: {
          slug: 'test',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          agentTool: { enabled: true },
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
        dataType: port.text(),
        bindingType: 'config',
      };
      expect(inferBindingType(portWithExplicit)).toBe('config');
    });

    it('infers credential for secret ports', () => {
      const secretPort: ComponentPortMetadata = {
        id: 'apiKey',
        label: 'API Key',
        dataType: port.secret(),
      };
      expect(inferBindingType(secretPort)).toBe('credential');
    });

    it('infers credential for contract ports with credential flag', () => {
      const contractPort: ComponentPortMetadata = {
        id: 'awsCreds',
        label: 'AWS Credentials',
        dataType: port.credential('aws'),
      };
      expect(inferBindingType(contractPort)).toBe('credential');
    });

    it('infers action for text ports', () => {
      const textPort: ComponentPortMetadata = {
        id: 'target',
        label: 'Target',
        dataType: port.text(),
      };
      expect(inferBindingType(textPort)).toBe('action');
    });

    it('infers action for number ports', () => {
      const numberPort: ComponentPortMetadata = {
        id: 'count',
        label: 'Count',
        dataType: port.number(),
      };
      expect(inferBindingType(numberPort)).toBe('action');
    });
  });

  describe('getCredentialInputIds', () => {
    it('returns IDs of credential inputs', () => {
      const component = createComponent({
        metadata: {
          slug: 'test',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          inputs: [
            { id: 'apiKey', label: 'API Key', dataType: port.secret() },
            { id: 'target', label: 'Target', dataType: port.text() },
            { id: 'awsCreds', label: 'AWS', dataType: port.credential('aws') },
          ],
        },
      });
      expect(getCredentialInputIds(component)).toEqual(['apiKey', 'awsCreds']);
    });
  });

  describe('getActionInputIds', () => {
    it('returns IDs of action inputs', () => {
      const component = createComponent({
        metadata: {
          slug: 'test',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          inputs: [
            { id: 'apiKey', label: 'API Key', dataType: port.secret() },
            { id: 'target', label: 'Target', dataType: port.text() },
            { id: 'count', label: 'Count', dataType: port.number() },
          ],
        },
      });
      expect(getActionInputIds(component)).toEqual(['target', 'count']);
    });
  });

  describe('getToolSchema', () => {
    it('returns schema with action inputs only', () => {
      const component = createComponent({
        metadata: {
          slug: 'test',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          inputs: [
            { id: 'apiKey', label: 'API Key', dataType: port.secret() },
            { id: 'ipAddress', label: 'IP Address', dataType: port.text(), required: true, description: 'IP to check' },
            { id: 'verbose', label: 'Verbose', dataType: port.boolean() },
          ],
        },
      });

      const schema = getToolSchema(component);
      
      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties)).toEqual(['ipAddress', 'verbose']);
      expect(schema.properties.ipAddress).toEqual({
        type: 'string',
        description: 'IP to check',
      });
      expect(schema.properties.verbose).toEqual({
        type: 'boolean',
        description: 'Verbose',
      });
      expect(schema.required).toEqual(['ipAddress']);
    });
  });

  describe('getToolName', () => {
    it('uses agentTool.toolName when specified', () => {
      const component = createComponent({
        metadata: {
          slug: 'abuseipdb-lookup',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          agentTool: {
            enabled: true,
            toolName: 'check_ip_reputation',
          },
        },
      });
      expect(getToolName(component)).toBe('check_ip_reputation');
    });

    it('derives from slug when toolName not specified', () => {
      const component = createComponent({
        metadata: {
          slug: 'abuseipdb-lookup',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          agentTool: { enabled: true },
        },
      });
      expect(getToolName(component)).toBe('abuseipdb_lookup');
    });
  });

  describe('getToolMetadata', () => {
    it('returns complete tool metadata for MCP', () => {
      const component = createComponent({
        metadata: {
          slug: 'abuseipdb-lookup',
          version: '1.0.0',
          type: 'process',
          category: 'security',
          description: 'Look up IP reputation',
          agentTool: {
            enabled: true,
            toolName: 'check_ip_reputation',
            toolDescription: 'Check if an IP address is malicious',
          },
          inputs: [
            { id: 'apiKey', label: 'API Key', dataType: port.secret() },
            { id: 'ipAddress', label: 'IP Address', dataType: port.text(), required: true },
          ],
        },
      });

      const metadata = getToolMetadata(component);

      expect(metadata.name).toBe('check_ip_reputation');
      expect(metadata.description).toBe('Check if an IP address is malicious');
      expect(metadata.inputSchema.properties).toHaveProperty('ipAddress');
      expect(metadata.inputSchema.properties).not.toHaveProperty('apiKey');
    });
  });
});
