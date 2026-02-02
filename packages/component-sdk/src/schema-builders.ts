import { z } from 'zod';

import { withPortMeta, type PortMeta } from './port-meta';
import { withParamMeta, type ParamMeta } from './param-meta';
import type {
  InputsSchema,
  OutputsSchema,
  ParametersSchema,
} from './types';

/**
 * Create a port schema with metadata and return a branded Zod type.
 *
 * Internally uses a Port class to store metadata, but returns a Zod schema
 * for backward compatibility with existing code that expects Zod objects.
 *
 * @example
 * ```ts
 * const textPort = port(z.string(), { label: 'Text' });
 * // Returns: ZodString with metadata attached
 * ```
 */
export function port<T extends z.ZodTypeAny>(schema: T, meta: PortMeta): T {
  return withPortMeta(schema, meta);
}

/**
 * Create a parameter schema with metadata and return a branded Zod type.
 *
 * @example
 * ```ts
 * const modeParam = param(z.enum(['upper', 'lower']), {
 *   label: 'Mode',
 *   editor: 'select',
 * });
 * // Returns: ZodEnum with metadata attached
 * ```
 */
export function param<T extends z.ZodTypeAny>(schema: T, meta: ParamMeta): T {
  return withParamMeta(schema, meta);
}

/**
 * Create a branded inputs schema from a record of port schemas.
 *
 * @example
 * ```ts
 * const inputSchema = inputs({
 *   text: port(z.string(), { label: 'Text' }),
 *   count: port(z.number(), { label: 'Count' }),
 * });
 * ```
 */
export function inputs<T extends Record<string, z.ZodTypeAny>>(
  shape: T
): InputsSchema<T> {
  return z.object(shape) as unknown as InputsSchema<T>;
}

/**
 * Create a branded outputs schema from a record of port schemas.
 *
 * @example
 * ```ts
 * const outputSchema = outputs({
 *   result: port(z.string(), { label: 'Result' }),
 * });
 * ```
 */
export function outputs<T extends Record<string, z.ZodTypeAny>>(
  shape: T
): OutputsSchema<T> {
  return z.object(shape) as unknown as OutputsSchema<T>;
}

/**
 * Create a branded parameters schema from a record of parameter schemas.
 *
 * @example
 * ```ts
 * const paramSchema = parameters({
 *   mode: param(z.enum(['upper', 'lower']), {
 *     label: 'Mode',
 *     editor: 'select',
 *   }),
 * });
 * ```
 */
export function parameters<T extends Record<string, z.ZodTypeAny>>(
  shape: T
): ParametersSchema<T> {
  return z.object(shape) as unknown as ParametersSchema<T>;
}
