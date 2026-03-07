import { z } from 'zod';
import { type ComponentListItem, ComponentListItemSchema } from '@shipsec/shared';

/**
 * ComponentMetadata is the canonical component type, defined in @shipsec/shared.
 * Re-exported here for convenience since many frontend files import from this module.
 */
export type ComponentMetadata = ComponentListItem;
export const ComponentMetadataSchema = ComponentListItemSchema;

/** Derive port and parameter types from the canonical component schema */
export type InputPort = ComponentMetadata['inputs'][number];
export type OutputPort = ComponentMetadata['outputs'][number];
export type Parameter = ComponentMetadata['parameters'][number];
export type ComponentAuthor = NonNullable<ComponentMetadata['author']>;
export type ComponentCategoryConfig = ComponentMetadata['categoryConfig'];

// --- Frontend-specific schemas (used by workflow builder for validation/construction) ---

export const ComponentRunnerSchema = z
  .object({
    kind: z.enum(['inline', 'docker', 'remote']),
  })
  .passthrough();

const PrimitivePortTypes = ['any', 'text', 'secret', 'number', 'boolean', 'file', 'json'] as const;
export const PrimitivePortTypeEnum = z.enum(PrimitivePortTypes);

const PortEditorTypes = [
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'multi-select',
  'json',
  'secret',
] as const;
export const PortEditorTypeEnum = z.enum(PortEditorTypes);

const ConnectionPrimitiveSchema = z.object({
  kind: z.literal('primitive'),
  name: PrimitivePortTypeEnum,
});

const ConnectionContractSchema = z.object({
  kind: z.literal('contract'),
  name: z.string().min(1),
  credential: z.boolean().optional(),
});

const ConnectionAnySchema = z.object({
  kind: z.literal('any'),
});

export const ConnectionTypeSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    ConnectionAnySchema,
    ConnectionPrimitiveSchema,
    ConnectionContractSchema,
    z.object({
      kind: z.literal('list'),
      element: ConnectionTypeSchema,
    }),
    z.object({
      kind: z.literal('map'),
      element: ConnectionTypeSchema,
    }),
  ]),
);

export type ConnectionType = z.infer<typeof ConnectionTypeSchema>;
