import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  withPortMeta,
  getPortMeta,
  mergePortMeta,
  type PortMeta,
} from '../port-meta';
import { port } from '../schema-builders';
import {
  extractPorts,
  deriveConnectionType,
  canConnect,
} from '../zod-ports';
import type { ConnectionType } from '../types';
import { validateComponentSchema } from '../schema-validation';

describe('Port Metadata System', () => {
  describe('withPortMeta', () => {
    it('stores metadata externally', () => {
      const schema = withPortMeta(z.string(), { label: 'Test Label' });

      const typeName = (schema as any)._def?.type;
      expect(typeName).toBe('string');

      const meta = getPortMeta(schema);
      expect(meta).toBeDefined();
      expect(meta?.label).toBe('Test Label');
    });

    it('replaces metadata when called multiple times', () => {
      const schema = withPortMeta(
        withPortMeta(z.string(), { label: 'First' }),
        { label: 'Second', description: 'Merged' }
      );

      const meta = getPortMeta(schema);
      expect(meta?.label).toBe('Second');
      expect(meta?.description).toBe('Merged');
    });

    it('supports all metadata fields', () => {
      const meta: PortMeta = {
        label: 'API Key',
        bindingType: 'credential',
        icon: 'Key',
        description: 'Key for API access',
        valuePriority: 'manual-first',
        isBranching: true,
        branchColor: 'green',
        connectionType: 'custom-type',
        editor: 'secret',
        allowAny: true,
        reason: 'Dynamic keys',
        schemaName: 'api-key',
        isCredential: true,
      };

      const schema = withPortMeta(z.string(), meta);

      const retrieved = getPortMeta(schema);
      expect(retrieved).toEqual(meta);
    });
  });

  describe('port', () => {
    it('wraps schema and stores metadata', () => {
      const schema = port(z.string(), { label: 'Port Label' });
      const meta = getPortMeta(schema);
      expect(meta?.label).toBe('Port Label');
    });
  });

  describe('getPortMeta', () => {
    it('returns undefined for schema without metadata', () => {
      const schema = z.string();
      const meta = getPortMeta(schema);
      expect(meta).toBeUndefined();
    });

    it('returns latest metadata when called multiple times', () => {
      const schema = withPortMeta(
        withPortMeta(z.string(), { label: 'First' }),
        { label: 'Second', description: 'Merged' }
      );

      const meta = getPortMeta(schema);
      expect(meta?.label).toBe('Second');
      expect(meta?.description).toBe('Merged');
    });
  });

  describe('mergePortMeta', () => {
    it('merges multiple metadata objects', () => {
      const meta1: PortMeta = { label: 'First', allowAny: true };
      const meta2: PortMeta = { label: 'Second', reason: 'Merged', icon: 'Key' };

      const merged = mergePortMeta(meta1, meta2, undefined);

      expect(merged).toEqual({
        label: 'Second',
        allowAny: true,
        reason: 'Merged',
        icon: 'Key',
      });
    });

    it('handles undefined values', () => {
      const meta1: PortMeta = { label: 'First' };
      const merged = mergePortMeta(meta1, undefined, undefined);

      expect(merged).toEqual(meta1);
    });
  });
});

describe('Port Extraction', () => {
  describe('extractPorts', () => {
    it('extracts ports from Zod object schema', () => {
      const schema = z.object({
        apiKey: withPortMeta(z.string(), { label: 'API Key' }),
        target: withPortMeta(z.string().optional(), { label: 'Target' }),
        count: withPortMeta(z.number().default(0), { label: 'Count' }),
      });

      const ports = extractPorts(schema);

      expect(ports).toHaveLength(3);
      expect(ports[0]).toEqual(expect.objectContaining({
        id: 'apiKey',
        label: 'API Key',
        connectionType: expect.any(Object),
        required: true,
      }));
      expect(ports[1]).toEqual(expect.objectContaining({
        id: 'target',
        label: 'Target',
        connectionType: expect.any(Object),
        required: false,
      }));
      expect(ports[2]).toEqual(expect.objectContaining({
        id: 'count',
        label: 'Count',
        connectionType: expect.any(Object),
        required: false,
      }));
    });

    it('defaults label to field name', () => {
      const schema = z.object({
        name: withPortMeta(z.string(), {}),
      });

      const ports = extractPorts(schema);

      expect(ports[0].label).toBe('name');
    });

    it('includes all PortMeta fields', () => {
      const schema = z.object({
        port1: withPortMeta(z.string(), {
          label: 'Port 1',
          description: 'Test port',
          valuePriority: 'manual-first',
        }),
      });

      const ports = extractPorts(schema);

      expect(ports[0].description).toBe('Test port');
      expect(ports[0].valuePriority).toBe('manual-first');
    });
  });

  describe('deriveConnectionType', () => {
    it('derives primitive types', () => {
      const type = deriveConnectionType(z.string());
      expect(type).toEqual({ kind: 'primitive', name: 'text' });

      expect(deriveConnectionType(z.number())).toEqual({ kind: 'primitive', name: 'number' });
      expect(deriveConnectionType(z.boolean())).toEqual({ kind: 'primitive', name: 'boolean' });
    });

    it('derives array types', () => {
      const type = deriveConnectionType(z.array(z.string()));
      expect(type).toEqual({
        kind: 'list',
        element: { kind: 'primitive', name: 'text' },
      });
    });

    it('derives record types', () => {
      const type = deriveConnectionType(z.record(z.string(), z.string()));
      expect(type).toEqual({
        kind: 'map',
        element: { kind: 'primitive', name: 'text' },
      });
    });

    it('uses connectionType override from meta', () => {
      const type = deriveConnectionType(
        withPortMeta(z.union([z.string(), z.number()]), {
          connectionType: 'custom-union',
        })
      );

      expect(type).toEqual({
        kind: 'contract',
        name: 'custom-union',
      });
    });

    it('throws for z.any() without allowAny', () => {
      expect(() => deriveConnectionType(z.any())).toThrow();
    });

    it('allows z.any() with explicit allowAny', () => {
      const type = deriveConnectionType(
        withPortMeta(z.any(), { allowAny: true, reason: 'Dynamic data' })
      );

      expect(type).toEqual({ kind: 'any' });
    });

    it('extracts schemaName for contracts', () => {
      const type = deriveConnectionType(
        withPortMeta(z.object({}), { schemaName: 'MyContract' })
      );

      expect(type).toEqual({
        kind: 'contract',
        name: 'MyContract',
      });
    });
  });
});

describe('Connection Compatibility', () => {
  describe('canConnect', () => {
    it('allows same primitive types', () => {
      const source: ConnectionType = { kind: 'primitive', name: 'text' };
      const target: ConnectionType = { kind: 'primitive', name: 'text' };

      expect(canConnect(source, target)).toBe(true);
    });

    it('allows any type connections', () => {
      const source: ConnectionType = { kind: 'primitive', name: 'text' };
      const target: ConnectionType = { kind: 'any' };

      expect(canConnect(source, target)).toBe(true);

      expect(canConnect({ kind: 'any' }, target)).toBe(true);
    });

    it('allows coercion from number to text', () => {
      const source: ConnectionType = { kind: 'primitive', name: 'number' };
      const target: ConnectionType = { kind: 'primitive', name: 'text' };

      expect(canConnect(source, target)).toBe(true);
    });

    it('disallows incompatible primitives', () => {
      const source: ConnectionType = { kind: 'primitive', name: 'file' };
      const target: ConnectionType = { kind: 'primitive', name: 'number' };

      expect(canConnect(source, target)).toBe(false);
    });

    it('matches contract names exactly', () => {
      const source: ConnectionType = { kind: 'contract', name: 'api-key' };
      const target: ConnectionType = { kind: 'contract', name: 'api-key' };

      expect(canConnect(source, target)).toBe(true);

      const target2: ConnectionType = { kind: 'contract', name: 'other-key' };
      expect(canConnect(source, target2)).toBe(false);
    });

    it('recursively checks list elements', () => {
      const source: ConnectionType = {
        kind: 'list',
        element: { kind: 'primitive', name: 'file' },
      };
      const target: ConnectionType = {
        kind: 'list',
        element: { kind: 'primitive', name: 'file' },
      };

      expect(canConnect(source, target)).toBe(true);

      const target2: ConnectionType = {
        kind: 'list',
        element: { kind: 'primitive', name: 'number' },
      };

      expect(canConnect(source, target2)).toBe(false);
    });

    it('recursively checks map values', () => {
      const source: ConnectionType = {
        kind: 'map',
        element: { kind: 'primitive', name: 'text' },
      };
      const target: ConnectionType = {
        kind: 'map',
        element: { kind: 'primitive', name: 'text' },
      };

      expect(canConnect(source, target)).toBe(true);
    });
  });
});

describe('Schema Validation', () => {
  describe('validateComponentSchema', () => {
    it('validates schemas without errors', () => {
      const schema = z.object({
        field1: withPortMeta(z.string(), { label: 'Field 1' }),
        field2: withPortMeta(z.number(), { label: 'Field 2' }),
      });

      const result = validateComponentSchema(schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('blocks z.any() without allowAny', () => {
      const schema = z.object({
        anyField: withPortMeta(z.any(), { label: 'Any Field' }),
      });

      const result = validateComponentSchema(schema);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('anyField');
      expect(result.errors[0]).toContain('allowAny=true');
    });

    it('allows z.any() with explicit allowAny and reason', () => {
      const schema = z.object({
        anyField: withPortMeta(z.any(), { allowAny: true, reason: 'Dynamic keys' }),
      });

      const result = validateComponentSchema(schema);

      expect(result.valid).toBe(true);
    });

    it('requires reason when allowAny=true', () => {
      const schema = z.object({
        anyField: withPortMeta(z.any(), { allowAny: true }),
      });

      const result = validateComponentSchema(schema);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('meta.reason');
    });

    it('enforces max depth limit', () => {
      const schema = z.object({
        shallow: withPortMeta(
          z.object({
            deep: z.object({
              tooDeep: z.string(),
            }),
          }),
          { label: 'Shallow' },
        ),
      });

      const result = validateComponentSchema(schema, { maxDepth: 2 });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('shallow'))).toBe(true);
      expect(result.errors.some((error) => error.includes('max depth 2'))).toBe(true);
    });

    it('requires connectionType for union types', () => {
      const schema = z.object({
        unionField: withPortMeta(z.union([z.string(), z.number()]), { label: 'Union Field' }),
      });

      const result = validateComponentSchema(schema);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('unionField');
      expect(result.errors[0]).toContain('meta.connectionType');
    });

    it('allows union with connectionType override', () => {
      const schema = z.object({
        unionField: withPortMeta(z.union([z.string(), z.number()]), {
          connectionType: 'custom-union',
        }),
      });

      const result = validateComponentSchema(schema);

      expect(result.valid).toBe(true);
    });
  });
});
