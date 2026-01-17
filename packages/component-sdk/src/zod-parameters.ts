/**
 * Zod Parameter Extraction
 *
 * Derives parameter metadata from Zod schemas with param() metadata.
 */

import { z } from 'zod';
import type { ComponentParameterMetadata } from './types';
import { getParamMeta } from './param-meta';

type ZodDef = { type?: string; typeName?: string; [key: string]: any };

const LEGACY_TYPE_MAP: Record<string, string> = {
  ZodObject: 'object',
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

export function extractParameters(schema: z.ZodTypeAny): ComponentParameterMetadata[] {
  const parameters: ComponentParameterMetadata[] = [];
  const objectSchema = unwrapToObject(schema);
  if (!objectSchema) {
    return parameters;
  }
  const shape = getObjectShape(objectSchema);

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const typedSchema = fieldSchema as z.ZodTypeAny;
    const paramMeta = getParamMeta(typedSchema);
    if (!paramMeta) {
      continue;
    }

    const required = !isOptional(typedSchema);
    const defaultValue = getDefaultValue(typedSchema);

    parameters.push({
      id: fieldName,
      label: paramMeta.label || fieldName,
      type: paramMeta.editor,
      required,
      default: defaultValue,
      placeholder: paramMeta.placeholder,
      description: paramMeta.description,
      helpText: paramMeta.helpText,
      options: paramMeta.options,
      min: paramMeta.min,
      max: paramMeta.max,
      rows: paramMeta.rows,
      visibleWhen: paramMeta.visibleWhen,
    });
  }

  return parameters;
}

function getDefaultValue(schema: z.ZodTypeAny): unknown {
  let current = schema;
  while (true) {
    const def = (current as any)._def as ZodDef | undefined;
    if (!def) {
      return undefined;
    }
    const typeName = getDefType(def);
    if (typeName === 'default') {
      const defaultValue = def.defaultValue;
      if (typeof defaultValue === 'function') {
        return defaultValue();
      }
      return defaultValue;
    }
    if (typeName === 'optional' || typeName === 'nullable') {
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
    return undefined;
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  let current = schema;
  while (true) {
    const def = (current as any)._def as ZodDef | undefined;
    if (!def) {
      return false;
    }
    const typeName = getDefType(def);
    if (typeName === 'optional' || typeName === 'default') {
      return true;
    }
    if (typeName === 'nullable' || typeName === 'effects') {
      current = typeName === 'effects' ? def.schema : def.innerType;
      continue;
    }
    if (typeName === 'pipe') {
      current = def.out ?? def.schema ?? def.innerType ?? def.in ?? current;
      continue;
    }
    return false;
  }
}

function unwrapToObject(schema: z.ZodTypeAny): z.ZodObject<any, any> | null {
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

function getObjectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  const shape = (schema as any).shape;
  if (typeof shape === 'function') {
    return shape();
  }
  return shape ?? {};
}
