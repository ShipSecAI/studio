/**
 * Schema Validation Pipeline
 *
 * Validates Zod schemas according to ShipSec's typing rules:
 * - Requires labels (or defaults to field name)
 * - Blocks z.any()/z.unknown() without explicit allowAny
 * - Requires schemaName for named contracts
 * - Requires connectionType/editor override for unions/complex types
 */

import { z } from 'zod';
import { getPortMeta } from './port-meta';
import { getParamMeta } from './param-meta';
import { deriveConnectionType } from './zod-ports';

type ZodDef = { type?: string; typeName?: string; [key: string]: any };

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
};

function getDefType(def: ZodDef | undefined): string | undefined {
  const raw = def?.type ?? def?.typeName;
  return raw ? LEGACY_TYPE_MAP[raw] ?? raw : undefined;
}

function getSchemaType(schema: z.ZodTypeAny): string | undefined {
  return getDefType((schema as any)._def);
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

const DEFAULT_MAX_DEPTH = 1;

/**
 * Validate a Zod schema against ShipSec typing rules
 *
 * @param schema - Zod schema to validate
 * @param options - Validation options
 * @returns Validation result with any errors found
 */
export function validateComponentSchema(
  schema: z.ZodTypeAny,
  options: ValidationOptions = {}
): SchemaValidationResult {
  const errors: string[] = [];
  const objectSchema = unwrapToObject(schema);
  if (!objectSchema) {
    return { valid: true, errors };
  }
  const shape = getObjectShape(objectSchema);

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const typedSchema = fieldSchema as z.ZodTypeAny;
    const portMeta = getPortMeta(typedSchema);
    if (!portMeta) {
      continue;
    }
    try {
      deriveConnectionType(typedSchema);
    } catch (error) {
      errors.push(
        `Field "${fieldName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Rule: Require label or default to field name
    if (!portMeta?.label) {
      // OK - will default to field name in extractPorts
    }

    // Rule: Block z.any()/z.unknown() without explicit allowAny
    const unwrapped = unwrapEffects(typedSchema);
    if (isAnyOrUnknown(unwrapped) && !portMeta?.allowAny) {
      errors.push(
        `Field "${fieldName}": z.any() or z.unknown() requires explicit meta.allowAny=true${portMeta?.reason ? ` (${portMeta.reason})` : ''}`
      );
    }

    // Rule: If allowAny is set, require reason
    if (portMeta?.allowAny && !portMeta?.reason) {
      errors.push(`Field "${fieldName}": meta.allowAny=true requires meta.reason explaining why`);
    }

    // Rule: Check depth limit (default 1 level)
    if (options.maxDepth !== undefined) {
      const depth = calculateDepth(typedSchema);
      if (depth > options.maxDepth) {
        errors.push(
          `Field "${fieldName}": Nesting depth ${depth} exceeds max depth ${options.maxDepth}. Use meta.connectionType for complex nested types.`
        );
      }
    }

    // Rule: If schemaName is set, it's a contract export
    if (portMeta?.schemaName) {
      // OK - explicit contract export
    }

    // Rule: Union/complex types require explicit connectionType or editor
    const unwrappedForUnion = unwrapEffects(typedSchema);
    if (isUnionType(unwrappedForUnion)) {
      if (!portMeta?.connectionType && !portMeta?.editor && !portMeta?.schemaName) {
        errors.push(
          `Field "${fieldName}": Union types require explicit meta.connectionType or meta.editor override`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateParameterSchema(
  schema: z.ZodTypeAny
): SchemaValidationResult {
  const errors: string[] = [];
  const objectSchema = unwrapToObject(schema);
  if (!objectSchema) {
    return { valid: true, errors };
  }
  const shape = getObjectShape(objectSchema);

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const typedSchema = fieldSchema as z.ZodTypeAny;
    const paramMeta = getParamMeta(typedSchema);
    if (!paramMeta) {
      errors.push(`Field "${fieldName}": parameters require param() metadata`);
      continue;
    }

    if (!paramMeta.label) {
      errors.push(`Field "${fieldName}": param() metadata requires a label`);
    }

    if (!paramMeta.editor) {
      errors.push(`Field "${fieldName}": param() metadata requires an editor type`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface ValidationOptions {
  /** Maximum nesting depth for port-visible fields (default: 1) */
  maxDepth?: number;
  /** Component ID for error context */
  componentId?: string;
}

/**
 * Calculate nesting depth of a Zod schema
 * Depth = 1 for primitive/object shallow, >1 for nested
 */
function calculateDepth(schema: z.ZodTypeAny): number {
  const unwrapped = unwrapEffects(schema);
  const typeName = getSchemaType(unwrapped);

  // Primitives: depth 1
  if (isPrimitiveType(unwrapped)) {
    return 1;
  }

  // Object: depth = 1 + max(field depth)
  if (typeName === 'object') {
    const shape = getObjectShape(unwrapped);
    let maxChildDepth = 0;

    for (const field of Object.values(shape)) {
      const childDepth = calculateDepth(field as z.ZodTypeAny);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }

    return 1 + maxChildDepth;
  }

  // Array: depth = element depth
  if (typeName === 'array') {
    const element = (unwrapped as any)._def.element ?? (unwrapped as any)._def.type;
    return calculateDepth(element as z.ZodTypeAny);
  }

  // Record: depth = value depth
  if (typeName === 'record') {
    const value =
      (unwrapped as any)._def.valueType ??
      (unwrapped as any)._def.value ??
      (unwrapped as any)._def.keyType;
    if (!value) {
      return 1;
    }
    return calculateDepth(value as z.ZodTypeAny);
  }

  // Default depth for unknown types
  return 1;
}

/**
 * Unwrap optional, nullable, default effects
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
 * Check if schema is z.any() or z.unknown()
 */
function isAnyOrUnknown(schema: z.ZodTypeAny): boolean {
  const typeName = getSchemaType(schema);
  return typeName === 'any' || typeName === 'unknown';
}

/**
 * Check if schema is a primitive type
 */
function isPrimitiveType(schema: z.ZodTypeAny): boolean {
  const typeName = getSchemaType(schema);
  return ['string', 'number', 'boolean', 'bigint', 'date', 'symbol'].includes(typeName ?? '');
}

/**
 * Check if schema is a union type
 */
function isUnionType(schema: z.ZodTypeAny): boolean {
  return getSchemaType(schema) === 'union';
}

function getObjectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  const shape = (schema as any).shape;
  if (typeof shape === 'function') {
    return shape();
  }
  return shape ?? {};
}
