import { z } from 'zod';
import type {
  ComponentDefinition,
  InputsSchema,
  OutputsSchema,
  ParametersSchema,
  ExecutionPayload,
  ExecutionContext,
} from './types';
import type { PortSchema, ParamSchema } from './types';

/**
 * Strongly-typed component definition helper that infers types from Zod schemas.
 *
 * This helper ensures that the execute function's payload types match the inferred
 * types from the input/output/parameter schemas, providing full type safety without
 * manual type annotations.
 *
 * @example
 * ```ts
 * const inputSchema = inputs({
 *   text: port(z.string()),
 * });
 * const outputSchema = outputs({
 *   result: port(z.string()),
 * });
 * const paramSchema = parameters({
 *   mode: param(z.enum(['upper', 'lower'])),
 * });
 *
 * defineComponent({
 *   id: 'example',
 *   label: 'Example',
 *   category: 'transform',
 *   runner: { kind: 'inline' },
 *   inputs: inputSchema,
 *   outputs: outputSchema,
 *   parameters: paramSchema,
 *   execute: async ({ inputs, params }) => {
 *     // TypeScript knows inputs.text is string and params.mode is 'upper' | 'lower'
 *     return { result: inputs.text };
 *   },
 * });
 * ```
 */

// Helper types to extract inferred types from branded schemas
type InferInputs<T> = T extends { __inferred: infer I } ? I : never;
type InferOutputs<T> = T extends { __inferred: infer O } ? O : never;
type InferParams<T> = T extends { __inferred: infer P } ? P : never;

// Helper to infer the resolved port types from resolvePorts return type
type InferResolvedInputs<T> = T extends { inputs: infer I } ? (I extends InputsSchema<infer S> ? z.infer<z.ZodObject<S>> : never) : never;
type InferResolvedOutputs<T> = T extends { outputs: infer O } ? (O extends OutputsSchema<infer S> ? z.infer<z.ZodObject<S>> : never) : never;

// ==============================================================================
// Overload 1: Static ports, no parameters
// ==============================================================================
export function defineComponent<
  IS extends Record<string, any>,
  OS extends Record<string, any>
>(
  definition: Omit<
    ComponentDefinition<IS, OS, {}, InferInputs<InputsSchema<IS>>, InferOutputs<OutputsSchema<OS>>, {}>,
    'inputs' | 'outputs' | 'parameters' | 'execute'
  > & {
    inputs: InputsSchema<IS>;
    outputs: OutputsSchema<OS>;
    parameters?: undefined;
    execute: (
      payload: ExecutionPayload<InferInputs<InputsSchema<IS>>, {}>,
      context: ExecutionContext,
    ) => Promise<InferOutputs<OutputsSchema<OS>>>;
  },
): ComponentDefinition<IS, OS, {}, InferInputs<InputsSchema<IS>>, InferOutputs<OutputsSchema<OS>>, {}>;

// ==============================================================================
// Overload 2: Static ports, with parameters
// ==============================================================================
export function defineComponent<
  IS extends Record<string, any>,
  OS extends Record<string, any>,
  PS extends Record<string, any>
>(
  definition: Omit<
    ComponentDefinition<IS, OS, PS, InferInputs<InputsSchema<IS>>, InferOutputs<OutputsSchema<OS>>, InferParams<ParametersSchema<PS>>>,
    'inputs' | 'outputs' | 'parameters' | 'execute'
  > & {
    inputs: InputsSchema<IS>;
    outputs: OutputsSchema<OS>;
    parameters: ParametersSchema<PS>;
    execute: (
      payload: ExecutionPayload<InferInputs<InputsSchema<IS>>, InferParams<ParametersSchema<PS>>>,
      context: ExecutionContext,
    ) => Promise<InferOutputs<OutputsSchema<OS>>>;
  },
): ComponentDefinition<IS, OS, PS, InferInputs<InputsSchema<IS>>, InferOutputs<OutputsSchema<OS>>, InferParams<ParametersSchema<PS>>>;

// ==============================================================================
// Overload 3: Dynamic outputs (with resolvePorts), static inputs
// ==============================================================================
export function defineComponent<
  IS extends Record<string, any>,
  OS extends Record<string, any>,
  PS extends Record<string, any>
>(
  definition: Omit<
    ComponentDefinition<IS, OS, PS, any, any, InferParams<ParametersSchema<PS>>>,
    'inputs' | 'outputs' | 'parameters' | 'execute' | 'resolvePorts'
  > & {
    inputs: InputsSchema<IS>;
    outputs: OutputsSchema<OS>;
    parameters: ParametersSchema<PS>;
    resolvePorts: (
      params: InferParams<ParametersSchema<PS>>,
    ) => {
      inputs?: InputsSchema<any>;
      outputs: OutputsSchema<any>;
    };
    execute: (
      payload: ExecutionPayload<any, InferParams<ParametersSchema<PS>>>,
      context: ExecutionContext,
    ) => Promise<any>;
  },
): ComponentDefinition<IS, OS, PS, any, any, InferParams<ParametersSchema<PS>>>;

// ==============================================================================
// Overload 4: Fully dynamic (inputs + outputs) with resolvePorts
// ==============================================================================
export function defineComponent<
  IS extends Record<string, any>,
  OS extends Record<string, any>,
  PS extends Record<string, any>
>(
  definition: Omit<
    ComponentDefinition<IS, OS, PS, any, any, InferParams<ParametersSchema<PS>>>,
    'inputs' | 'outputs' | 'parameters' | 'execute' | 'resolvePorts'
  > & {
    inputs: InputsSchema<IS>;
    outputs: OutputsSchema<OS>;
    parameters: ParametersSchema<PS>;
    resolvePorts: (
      params: InferParams<ParametersSchema<PS>>,
    ) => {
      inputs: InputsSchema<any>;
      outputs: OutputsSchema<any>;
    };
    execute: (
      payload: ExecutionPayload<any, InferParams<ParametersSchema<PS>>>,
      context: ExecutionContext,
    ) => Promise<any>;
  },
): ComponentDefinition<IS, OS, PS, any, any, InferParams<ParametersSchema<PS>>>;

// ==============================================================================
// Fallback implementation
// ==============================================================================
export function defineComponent<
  IS extends Record<string, any>,
  OS extends Record<string, any>,
  PS extends Record<string, any> | undefined = undefined
>(
  definition: any,
): any {
  return definition;
}
