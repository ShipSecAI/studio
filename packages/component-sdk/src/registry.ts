import type {
  ComponentDefinition,
  ComponentParameterMetadata,
  InputsSchema,
  OutputsSchema,
} from './types';
import { ConfigurationError } from './errors';
import { z } from 'zod';
import { extractPorts } from './zod-ports';
import { extractParameters } from './zod-parameters';
import { getPortMeta } from './port-meta';
import { validateComponentSchema, validateParameterSchema } from './schema-validation';

type AnyComponentDefinition = ComponentDefinition<any, any, any, any, any, any>;

/**
 * Extract the inferred TypeScript type from a branded schema.
 * Works with InputsSchema, OutputsSchema, and ParametersSchema.
 */
type InferredFromSchema<T> = T extends { __inferred: infer I } ? I : unknown;

/**
 * Extract the inner Zod shape from a branded schema.
 * e.g., InputsSchema<{ targets: PortSchema<...> }> -> { targets: PortSchema<...> }
 */
type ShapeFromSchema<T> = T extends z.ZodObject<infer S> ? S : Record<string, any>;

type ZodDef = { type?: string; typeName?: string;[key: string]: any };

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

export interface CachedComponentMetadata {
  definition: AnyComponentDefinition;
  inputs: any[];
  outputs: any[];
  parameters: ComponentParameterMetadata[];
  connectionTypes: Record<string, any>;
}

export class ComponentRegistry {
  private components = new Map<string, CachedComponentMetadata>();

  register<IS extends Record<string, any>, OS extends Record<string, any>, PS extends Record<string, any> = {}>(
    definition: ComponentDefinition<IS, OS, PS, any, any, any>
  ): void {
    if (this.components.has(definition.id)) {
      throw new ConfigurationError(`Component ${definition.id} is already registered`, {
        configKey: 'componentId',
        details: { componentId: definition.id },
      });
    }

    // Validate component schemas against ShipSec typing rules
    const inputValidation = validateComponentSchema(definition.inputs);
    if (!inputValidation.valid) {
      throw new ConfigurationError(
        `Component ${definition.id} has invalid input schema: ${inputValidation.errors.join(', ')}`,
        {
          configKey: 'inputs',
          details: { componentId: definition.id, errors: inputValidation.errors },
        }
      );
    }

    const outputValidation = validateComponentSchema(definition.outputs);
    if (!outputValidation.valid) {
      throw new ConfigurationError(
        `Component ${definition.id} has invalid output schema: ${outputValidation.errors.join(', ')}`,
        {
          configKey: 'outputs',
          details: { componentId: definition.id, errors: outputValidation.errors },
        }
      );
    }

    if (definition.parameters) {
      const parameterValidation = validateParameterSchema(definition.parameters);
      if (!parameterValidation.valid) {
        throw new ConfigurationError(
          `Component ${definition.id} has invalid parameter schema: ${parameterValidation.errors.join(', ')}`,
          {
            configKey: 'parameters',
            details: { componentId: definition.id, errors: parameterValidation.errors },
          }
        );
      }
    }

    validatePortMetadata(definition);

    // Compute derived ports and connection types
    const inputPorts = extractPorts(definition.inputs);
    const outputPorts = extractPorts(definition.outputs);
    const parameterFields = definition.parameters
      ? extractParameters(definition.parameters)
      : [];

    const connectionTypes: Record<string, any> = {};
    for (const port of [...inputPorts, ...outputPorts]) {
      if (port.connectionType) {
        connectionTypes[port.id] = port.connectionType;
      }
    }

    this.components.set(definition.id, {
      definition: definition as AnyComponentDefinition,
      inputs: inputPorts,
      outputs: outputPorts,
      parameters: parameterFields,
      connectionTypes,
    });
  }

  /**
   * Get a component by ID with full type safety.
   *
   * @example
   * ```ts
   * // In your component file, export the schema types:
   * export type InputSchema = typeof inputSchema;
   * export type OutputSchema = typeof outputSchema;
   *
   * // Then use them with get():
   * const component = componentRegistry.get<InputSchema, OutputSchema>('my.component');
   * const parsed = component.inputs.parse({ ... }); // Correctly typed!
   * const result = await component.execute(...);    // Returns correct output type!
   * ```
   */
  get<
    ISchema extends InputsSchema<any> = InputsSchema<Record<string, any>>,
    OSchema extends OutputsSchema<any> = OutputsSchema<Record<string, any>>
  >(
    id: string
  ): ComponentDefinition<
    ShapeFromSchema<ISchema>,
    ShapeFromSchema<OSchema>,
    any,
    InferredFromSchema<ISchema>,
    InferredFromSchema<OSchema>,
    any
  > | undefined {
    const cached = this.components.get(id);
    return cached?.definition as ComponentDefinition<
      ShapeFromSchema<ISchema>,
      ShapeFromSchema<OSchema>,
      any,
      InferredFromSchema<ISchema>,
      InferredFromSchema<OSchema>,
      any
    > | undefined;
  }

  getMetadata(id: string): CachedComponentMetadata | undefined {
    return this.components.get(id);
  }

  list(): Array<AnyComponentDefinition> {
    return Array.from(this.components.values()).map((c) => c.definition);
  }

  listMetadata(): Array<CachedComponentMetadata> {
    return Array.from(this.components.values());
  }

  has(id: string): boolean {
    return this.components.has(id);
  }

  clear(): void {
    this.components.clear();
  }
}

function validatePortMetadata(definition: AnyComponentDefinition) {
  const inputSchema = definition.inputs;
  const outputSchema = definition.outputs;

  const inputObject = unwrapToObject(inputSchema);
  if (inputObject) {
    const shape = getObjectShape(inputObject);
    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
      if (fieldName.startsWith('__')) {
        continue;
      }
      const portMeta = getPortMeta(fieldSchema);
      if (!portMeta) {
        throw new ConfigurationError(
          `Component ${definition.id} input \"${fieldName}\" must be a port (use port() or withPortMeta).`,
          {
            configKey: 'inputs',
            details: { componentId: definition.id, fieldName },
          }
        );
      }
    }
  }

  const outputObject = unwrapToObject(outputSchema);
  if (outputObject) {
    const shape = getObjectShape(outputObject);
    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
      if (fieldName.startsWith('__')) {
        continue;
      }
      const portMeta = getPortMeta(fieldSchema);
      if (!portMeta) {
        throw new ConfigurationError(
          `Component ${definition.id} output \"${fieldName}\" must declare port() or withPortMeta for port metadata.`,
          {
            configKey: 'outputs',
            details: { componentId: definition.id, fieldName },
          }
        );
      }
    }
  }
}

function getObjectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  const shape = (schema as any).shape;
  if (typeof shape === 'function') {
    return shape();
  }
  return shape ?? {};
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

export const componentRegistry = new ComponentRegistry();
