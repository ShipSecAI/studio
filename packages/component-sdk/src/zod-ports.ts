/**
 * Zod Port Extraction and Connection Types
 *
 * Derives port metadata and connection types from Zod schemas.
 * This replaces the legacy port-type system with Zod-first derivation.
 */

import { z } from 'zod';
import type { ComponentPortMetadata, ConnectionType } from './types';
import { getPortMeta, mergePortMeta, type PortMeta } from './port-meta';

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

type ZodDef = { type?: string; typeName?: string;[key: string]: any };

const LEGACY_TYPE_MAP: Record<string, string> = {
  ZodString: 'string',
  ZodNumber: 'number',
  ZodBoolean: 'boolean',
  ZodBigInt: 'bigint',
  ZodDate: 'date',
  ZodSymbol: 'symbol',
  ZodAny: 'any',
  ZodUnknown: 'unknown',
  ZodObject: 'object',
  ZodArray: 'array',
  ZodRecord: 'record',
  ZodUnion: 'union',
  ZodDiscriminatedUnion: 'union',
  ZodOptional: 'optional',
  ZodNullable: 'nullable',
  ZodDefault: 'default',
  ZodEffects: 'effects',
  ZodPipeline: 'pipe',
  ZodLiteral: 'literal',
  ZodEnum: 'enum',
  ZodNativeEnum: 'nativeEnum',
};

function getDefType(def: ZodDef | undefined): string | undefined {
  const raw = def?.type ?? def?.typeName;
  return raw ? LEGACY_TYPE_MAP[raw] ?? raw : undefined;
}

function getSchemaType(schema: z.ZodTypeAny): string | undefined {
  return getDefType((schema as any)._def);
}

function getEnumValueTypes(def: ZodDef): string[] {
  if (Array.isArray(def.values)) {
    return def.values.map((value) => typeof value);
  }
  if (def.entries && typeof def.entries === 'object') {
    return Object.values(def.entries).map((value) => typeof value);
  }
  return [];
}

function getArrayElement(def: ZodDef): z.ZodTypeAny | undefined {
  return def.element ?? def.type;
}

function getRecordValue(def: ZodDef): z.ZodTypeAny | undefined {
  return def.valueType ?? def.value ?? def.keyType;
}

function editorToConnectionType(editor?: PortMeta['editor']): ConnectionType | undefined {
  switch (editor) {
    case 'number':
      return { kind: 'primitive', name: 'number' };
    case 'boolean':
      return { kind: 'primitive', name: 'boolean' };
    case 'json':
      return { kind: 'primitive', name: 'json' };
    case 'secret':
      return { kind: 'primitive', name: 'secret' };
    case 'multi-select':
      return { kind: 'list', element: { kind: 'primitive', name: 'text' } };
    case 'text':
    case 'textarea':
    case 'select':
      return { kind: 'primitive', name: 'text' };
    default:
      return undefined;
  }
}

/**
 * Extract port metadata from a Zod schema (object keys)
 *
 * @param schema - Zod object schema to extract from
 * @param defaultLabelPrefix - Prefix for default labels (defaults to field name)
 * @returns Array of ComponentPortMetadata derived from schema keys
 */
export function extractPorts(
  schema: z.ZodTypeAny,
  defaultLabelPrefix: string = ''
): ComponentPortMetadata[] {
  const ports: ComponentPortMetadata[] = [];
  const objectSchema = unwrapToObject(schema);
  if (!objectSchema) {
    return ports;
  }
  const shape = typeof objectSchema.shape === 'function' ? objectSchema.shape() : objectSchema.shape;

  for (const [fieldName, fieldSchema] of Object.entries(
    shape as Record<string, z.ZodTypeAny>,
  )) {
    const typedSchema = fieldSchema as z.ZodTypeAny;
    const portMeta = getPortMeta(typedSchema);
    if (!portMeta) {
      continue;
    }
    const connectionType = deriveConnectionType(typedSchema);
    const isRequired = !isOptional(typedSchema);

    const metadata: PortMeta = portMeta;
    const label = metadata.label || fieldName;

    ports.push({
      id: fieldName,
      label,
      connectionType,
      bindingType: metadata.bindingType,
      editor: metadata.editor,
      required: isRequired,
      description: metadata.description,
      valuePriority: metadata.valuePriority,
      isBranching: metadata.isBranching,
      branchColor: metadata.branchColor,
      hidden: metadata.hidden,
    });
  }

  return ports;
}

/**
 * Derive connection type from Zod schema
 *
 * @param schema - Zod schema to analyze
 * @returns ConnectionType derived from schema
 */
export function deriveConnectionType(schema: z.ZodTypeAny): ConnectionType {
  // Check for explicit connection type override in metadata
  const portMeta = getPortMeta(schema);
  if (portMeta?.connectionType) {
    if (typeof portMeta.connectionType === 'string') {
      return {
        kind: 'contract',
        name: portMeta.connectionType,
      };
    }
    return portMeta.connectionType;
  }

  // Unwrap optional, nullable, default effects
  const unwrapped = unwrapEffects(schema);
  const defType = getSchemaType(unwrapped);

  // Check for schemaName (named contract) - takes precedence over generic types
  if (portMeta?.schemaName) {
    return {
      kind: 'contract',
      name: portMeta.schemaName,
      credential: portMeta.isCredential,
    };
  }

  // Handle explicit any/unknown with allowAny flag
  if (defType === 'any' || defType === 'unknown') {
    if (portMeta?.allowAny) {
      return { kind: 'any' };
    }
    throw new Error(
      `z.any() or z.unknown() requires explicit allowAny=true${portMeta?.reason ? `: ${portMeta.reason}` : ''}`
    );
  }

  const editorConnectionType = editorToConnectionType(portMeta?.editor);
  if (editorConnectionType) {
    return editorConnectionType;
  }

  // Primitive types
  if (isPrimitiveType(unwrapped)) {
    return {
      kind: 'primitive',
      name: getPrimitiveTypeName(unwrapped),
    };
  }

  // Array types
  if (defType === 'array') {
    const elementSchema = getArrayElement((unwrapped as any)._def ?? {});
    if (!elementSchema) {
      throw new Error('Array schema is missing element type');
    }
    const element = deriveConnectionType(elementSchema);
    return {
      kind: 'list',
      element,
    };
  }

  // Record types
  if (defType === 'record') {
    const valueSchema = getRecordValue((unwrapped as any)._def ?? {});
    if (!valueSchema) {
      throw new Error('Record schema is missing value type');
    }
    const value = deriveConnectionType(valueSchema);
    return {
      kind: 'map',
      element: value,
    };
  }

  // Union types - require explicit connectionType override
  if (defType === 'union') {
    if (portMeta?.connectionType) {
      return typeof portMeta.connectionType === 'string'
        ? { kind: 'contract', name: portMeta.connectionType }
        : portMeta.connectionType;
    }
    throw new Error(
      'Union types require explicit meta.connectionType override to define compatibility'
    );
  }

  // Default: treat as any with error (developer should be explicit)
  throw new Error(
    `Cannot derive connection type for schema. Use meta.connectionType or meta.schemaName for complex types.`
  );
}

/**
 * Check if two connection types are compatible
 *
 * @param source - Source connection type
 * @param target - Target connection type
 * @returns true if compatible, false otherwise
 */
export function canConnect(source: ConnectionType, target: ConnectionType): boolean {
  // Wildcard: any accepts anything and anything accepts any
  if (source.kind === 'any' || target.kind === 'any') {
    return true;
  }

  // Primitive to primitive: check coercion rules
  if (source.kind === 'primitive' && target.kind === 'primitive') {
    return source.name === target.name || canCoercePrimitive(source.name!, target.name!);
  }

  // Contract to contract: strict name match
  if (source.kind === 'contract' && target.kind === 'contract') {
    return source.name === target.name && source.credential === target.credential;
  }

  // List to list: recursive element check
  if (source.kind === 'list' && target.kind === 'list') {
    return canConnect(source.element!, target.element!);
  }

  // Map to map: recursive value check
  if (source.kind === 'map' && target.kind === 'map') {
    return canConnect(source.element!, target.element!);
  }

  return false;
}

/**
 * Unwrap optional, nullable, and default effects to get inner type
 */
function unwrapEffects(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;

  while (true) {
    const def = (current as any)._def as ZodDef | undefined;

    if (!def) break;

    const typeName = getDefType(def);

    if (typeName === 'optional' || typeName === 'nullable' || typeName === 'default') {
      current = def.innerType;
      continue;
    }

    if (typeName === 'effects') {
      current = def.schema;
      continue;
    }

    if (typeName === 'pipe') {
      current = def.out ?? def.schema ?? def.innerType ?? def.in ?? current;
      if (current === schema) break;
      continue;
    }

    break;
  }

  return current;
}

/**
 * Check if schema is optional (has optional effect)
 */
function isOptional(schema: z.ZodTypeAny): boolean {
  let current = schema;
  while (true) {
    const currentDef = (current as any)._def as ZodDef | undefined;
    if (!currentDef) {
      break;
    }
    const typeName = getDefType(currentDef);
    if (typeName === 'optional' || typeName === 'default') {
      return true;
    }
    if (typeName === 'nullable' || typeName === 'effects') {
      current = typeName === 'effects' ? currentDef.schema : currentDef.innerType;
      continue;
    }
    if (typeName === 'pipe') {
      current = currentDef.out ?? currentDef.schema ?? currentDef.innerType ?? currentDef.in ?? current;
      continue;
    }
    break;
  }

  return false;
}

function unwrapToObject(
  schema: z.ZodTypeAny
): z.ZodObject<any, any> | null {
  let current = schema;

  while (true) {
    const def = (current as any)._def as ZodDef | undefined;
    const typeName = getDefType(def);

    if (!def) {
      return null;
    }

    if (typeName === 'object') {
      return current as z.ZodObject<any, any>;
    }

    if (typeName === 'optional' || typeName === 'nullable' || typeName === 'default') {
      current = def.innerType;
      continue;
    }

    if (typeName === 'effects') {
      current = def.schema;
      continue;
    }

    if (typeName === 'pipe') {
      current = def.out ?? def.schema ?? def.innerType ?? def.in ?? current;
      continue;
    }

    return null;
  }
}

/**
 * Check if schema is a primitive type
 */
function isPrimitiveType(schema: z.ZodTypeAny): boolean {
  const typeName = getSchemaType(schema);
  return ['string', 'number', 'boolean', 'bigint', 'date', 'symbol', 'enum', 'literal'].includes(
    typeName ?? ''
  );
}

/**
 * Get primitive type name
 */
function getPrimitiveTypeName(schema: z.ZodTypeAny): string {
  const typeName = getSchemaType(schema);
  const def = (schema as any)._def as ZodDef | undefined;

  switch (typeName) {
    case 'string':
      return 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'bigint':
      return 'number';
    case 'date':
      return 'text';
    case 'symbol':
      return 'text';
    case 'enum': {
      const valueTypes = getEnumValueTypes(def ?? {});
      if (valueTypes.every((type) => type === 'number')) {
        return 'number';
      }
      if (valueTypes.every((type) => type === 'boolean')) {
        return 'boolean';
      }
      return 'text';
    }
    case 'literal': {
      const values = Array.isArray(def?.values) ? def?.values : [];
      const sample = values[0];
      if (typeof sample === 'number') {
        return 'number';
      }
      if (typeof sample === 'boolean') {
        return 'boolean';
      }
      return 'text';
    }
    default:
      return 'any';
  }
}

/**
 * Check if primitive can coerce from source to target
 */
function canCoercePrimitive(source: string, target: string): boolean {
  // Number and boolean can be coerced to text
  if (target === 'text') {
    return ['number', 'boolean', 'text'].includes(source);
  }

  // Text can be coerced to number or boolean if parseable
  if (target === 'number' || target === 'boolean') {
    return source === 'text';
  }

  return false;
}

export function describeConnectionType(connType: ConnectionType): string {
  if (connType.kind === 'any') {
    return 'any';
  }

  if (connType.kind === 'primitive') {
    return connType.name ?? 'any';
  }

  if (connType.kind === 'contract') {
    if (connType.name) {
      return connType.credential ? `credential:${connType.name}` : `contract:${connType.name}`;
    }
    return 'contract';
  }

  if (connType.kind === 'list') {
    return `list<${describeConnectionType(connType.element!)}>`;
  }

  if (connType.kind === 'map') {
    return `map<${describeConnectionType(connType.element!)}>`;
  }

  return 'unknown';
}

export function createPlaceholderForConnectionType(connType?: ConnectionType): unknown {
  if (!connType) {
    return null;
  }

  if (connType.kind === 'primitive') {
    switch (connType.name) {
      case 'text':
        return '__placeholder__';
      case 'secret':
        return 'secret-placeholder';
      case 'number':
        return 1;
      case 'boolean':
        return false;
      case 'file':
        return {};
      case 'json':
        return {};
      case 'any':
        return null;
      default:
        return null;
    }
  }

  if (connType.kind === 'list') {
    return [createPlaceholderForConnectionType(connType.element)];
  }

  if (connType.kind === 'map') {
    return { placeholder: createPlaceholderForConnectionType(connType.element) };
  }

  if (connType.kind === 'contract') {
    return connType.credential ? 'credential-placeholder' : {};
  }

  if (connType.kind === 'any') {
    return null;
  }

  return null;
}
