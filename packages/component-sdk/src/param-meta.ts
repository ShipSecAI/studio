/**
 * Zod Parameter Metadata System
 *
 * Stores parameter metadata for Zod schemas without global augmentation.
 * Parameter metadata is attached via the param() helper using a WeakMap.
 */

import { z } from 'zod';
import type { ComponentParameterType } from './types';

export interface ParamMeta {
  /** Display label (required) */
  label: string;
  /** Tooltip/help text */
  description?: string;
  /** Supplemental helper text */
  helpText?: string;
  /** Form field editor type */
  editor: ComponentParameterType;
  /** Placeholder text */
  placeholder?: string;
  /** Select options */
  options?: Array<{ label: string; value: unknown }>;
  /** Numeric min */
  min?: number;
  /** Numeric max */
  max?: number;
  /** Textarea rows */
  rows?: number;
  /** Conditional visibility */
  visibleWhen?: Record<string, unknown>;
}

const METADATA_STORE = new WeakMap<z.ZodTypeAny, ParamMeta>();

export function withParamMeta<T extends z.ZodTypeAny>(schema: T, meta: ParamMeta): T {
  const existing = METADATA_STORE.get(schema);
  METADATA_STORE.set(schema, mergeParamMeta(existing, meta));
  return schema;
}

export function getParamMeta(schema: z.ZodTypeAny): ParamMeta | undefined {
  return METADATA_STORE.get(schema);
}

export function mergeParamMeta(...metas: (ParamMeta | undefined)[]): ParamMeta {
  const result: ParamMeta = {} as ParamMeta;

  for (const meta of metas) {
    if (meta) {
      Object.assign(result, meta);
    }
  }

  return result;
}
