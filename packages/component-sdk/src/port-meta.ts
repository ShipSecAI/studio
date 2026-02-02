/**
 * Zod Port Metadata System
 *
 * This module provides typed port metadata for Zod schemas without global augmentation.
 * Port metadata is attached via the withPortMeta() helper using a WeakMap.
 */

import { z } from 'zod';
import type { ConnectionType, PortBindingType } from './types';

export interface PortMeta {
  /** Display label for the port (defaults to field name if not provided) */
  label?: string;
  /** Binding type for agent tools */
  bindingType?: PortBindingType;
  /** Icon identifier (lucide-react or custom) */
  icon?: string;
  /** Description for tooltips/help text */
  description?: string;
  /** Priority for value resolution: 'manual-first' | 'connection-first' */
  valuePriority?: 'manual-first' | 'connection-first';
  /** True if this port controls conditional execution (branching) */
  isBranching?: boolean;
  /** Custom color for branching ports */
  branchColor?: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'slate';
  /** Connection type override for unions/complex types */
  connectionType?: ConnectionType | string;
  /** Editor type override (e.g., 'textarea', 'select', 'secret') */
  editor?: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multi-select' | 'json' | 'secret';
  /** Allow z.any() or z.unknown() - must be explicitly set */
  allowAny?: boolean;
  /** Reason for using z.any()/z.unknown() (required when allowAny=true) */
  reason?: string;
  /** Schema name for named contracts (required for contract exports) */
  schemaName?: string;
  /** Mark this schema as a credential type */
  isCredential?: boolean;
  /** True if this port should be hidden from the UI (defaults to false) */
  hidden?: boolean;
}

const METADATA_STORE = new WeakMap<z.ZodTypeAny, PortMeta>();

/**
 * Attach port metadata to a Zod schema
 *
 * @param schema - The Zod type to enhance
 * @param meta - Port metadata to attach
 * @returns The same schema with metadata stored externally
 *
 * @example
 * ```ts
 * const inputs = z.object({
 *   apiKey: withPortMeta(z.string(), { label: 'API Key', bindingType: 'credential' }),
 *   target: withPortMeta(z.string(), { label: 'Target URL' }),
 * });
 * ```
 */
export function withPortMeta<T extends z.ZodTypeAny>(schema: T, meta: PortMeta): T {
  const existing = METADATA_STORE.get(schema);
  METADATA_STORE.set(schema, mergePortMeta(existing, meta));
  return schema;
}

/**
 * Extract port metadata from a Zod type
 *
 * @param schema - The Zod schema to extract from
 * @returns Port metadata if present, undefined otherwise
 */
export function getPortMeta(schema: z.ZodTypeAny): PortMeta | undefined {
  return METADATA_STORE.get(schema);
}

/**
 * Merge multiple port metadata objects
 * Later metadata overrides earlier metadata for overlapping keys
 *
 * @param metas - Array of port metadata to merge
 * @returns Merged port metadata
 */
export function mergePortMeta(...metas: (PortMeta | undefined)[]): PortMeta {
  const result: PortMeta = {};

  for (const meta of metas) {
    if (meta) {
      Object.assign(result, meta);
    }
  }

  return result;
}
