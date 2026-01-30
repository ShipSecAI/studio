/**
 * Helper functions for working with agent-callable components (tool mode).
 *
 * Uses Zod's built-in toJSONSchema() for accurate type conversion.
 * This correctly handles z.any(), z.union(), z.enum(), etc.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ComponentDefinition, ComponentPortMetadata, PortBindingType } from './types';
import { extractPorts } from './zod-ports';
import { getParamMeta } from './param-meta';

/**
 * Tool input schema - matches the MCP SDK's Tool.inputSchema type.
 * This is a JSON Schema object with type: 'object'.
 */
// export type ToolInputSchema = Tool['inputSchema'];
export type ToolInputSchema = Tool['inputSchema'];

/**
 * Tool input shape for MCP server registration.
 * This is a Zod raw shape (record of schemas).
 */
export type ToolInputShape = ZodRawShapeCompat;

/**
 * Metadata for an agent-callable tool, suitable for MCP tools/list response.
 * This is compatible with the MCP SDK's Tool type.
 */
export interface ToolMetadata {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

/**
 * Check if a component is configured as an agent-callable tool.
 */
export function isAgentCallable(component: ComponentDefinition): boolean {
  return component.ui?.agentTool?.enabled === true;
}

/**
 * Infer the binding type for a port based on its connection type.
 * - secret, contract with credential flag → 'credential'
 * - everything else → 'action'
 */
export function inferBindingType(port: ComponentPortMetadata): PortBindingType {
  // Explicit binding type takes precedence
  if (port.bindingType) {
    return port.bindingType;
  }

  // Check editor type
  if (port.editor === 'secret') {
    return 'credential';
  }

  const connectionType = port.connectionType;

  // Secret ports are always credentials
  if (connectionType.kind === 'primitive' && connectionType.name === 'secret') {
    return 'credential';
  }

  // Contract ports with credential flag are credentials
  if (connectionType.kind === 'contract' && connectionType.credential) {
    return 'credential';
  }

  // Everything else is an action input
  return 'action';
}

/**
 * Get the IDs of all credential inputs for a component.
 * These are inputs that should be pre-bound from the workflow, not exposed to the agent.
 */
export function getCredentialInputIds(component: ComponentDefinition): string[] {
  const inputs = extractPorts(component.inputs);
  return inputs
    .filter(input => inferBindingType(input) === 'credential')
    .map(input => input.id);
}

/**
 * Get the IDs of all action inputs for a component.
 * These are inputs that the agent provides at runtime.
 */
export function getActionInputIds(component: ComponentDefinition): string[] {
  const inputs = extractPorts(component.inputs);
  return inputs
    .filter(input => inferBindingType(input) === 'action')
    .map(input => input.id);
}

/**
 * Get the IDs of parameters explicitly exposed to the agent.
 * Secret parameters are always excluded.
 */
export function getExposedParameterIds(component: ComponentDefinition): string[] {
  if (!component.parameters) {
    return [];
  }

  const shape = getObjectShape(component.parameters);
  if (!shape) {
    return [];
  }

  return Object.entries(shape)
    .filter(([id, schema]) => {
      if (id.startsWith('__')) {
        return false;
      }
      const meta = getParamMeta(schema as any);
      if (!meta?.exposeToTool) {
        return false;
      }
      if (meta.editor === 'secret') {
        return false;
      }
      return true;
    })
    .map(([id]) => id);
}

// ============================================================================
// Schema Generation Helpers
// ============================================================================

/**
 * Pick specific keys from an object.
 */
function pick<T extends Record<string, unknown>, K extends string>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      (result as Record<string, unknown>)[key] = obj[key];
    }
  }
  return result;
}

type ZodObjectLike = {
  shape?: Record<string, AnySchema> | (() => Record<string, AnySchema>);
  _def?: {
    shape?: Record<string, AnySchema> | (() => Record<string, AnySchema>);
  };
};

function getObjectShape(schema: unknown): Record<string, AnySchema> | null {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  const objectSchema = schema as ZodObjectLike;
  const shape = objectSchema.shape ?? objectSchema._def?.shape;
  if (!shape) {
    return null;
  }

  return typeof shape === 'function' ? shape() : shape;
}

/**
 * Get the Zod raw shape for the action inputs only (inputs exposed to the agent).
 * This is used to register tools with the MCP server for input validation.
 */
export function getToolInputShape(component: ComponentDefinition): ToolInputShape {
  const shape = getObjectShape(component.inputs);
  if (!shape) {
    return {};
  }

  const actionInputIds = getActionInputIds(component);
  const filtered: ToolInputShape = {};

  for (const id of actionInputIds) {
    const schema = shape[id];
    if (schema) {
      filtered[id] = schema;
    }
  }

  const exposedParamIds = getExposedParameterIds(component);
  if (exposedParamIds.length > 0) {
    const paramShape = getObjectShape(component.parameters);
    if (paramShape) {
      for (const id of exposedParamIds) {
        if (filtered[id]) {
          continue;
        }
        const schema = paramShape[id];
        if (schema) {
          filtered[id] = schema;
        }
      }
    }
  }

  return filtered;
}

/**
 * Get the JSON Schema for the action inputs only (inputs exposed to the agent).
 * This is used for the MCP tools/list inputSchema field.
 *
 * Uses Zod's built-in toJSONSchema() for accurate type conversion.
 * This correctly handles:
 * - z.any() → {} (empty schema = any JSON value)
 * - z.union([...]) → { anyOf: [...] }
 * - z.enum([...]) → { type: 'string', enum: [...] }
 * - z.literal('X') → { type: 'string', const: 'X' }
 * - z.record(...) → { type: 'object', additionalProperties: {...} }
 */
export function getToolSchema(component: ComponentDefinition): ToolInputSchema {
  const inputsSchema = component.inputs;
  const parametersSchema = component.parameters;

  // 1. Generate full JSON Schema using Zod's built-in
  const fullSchema = (
    inputsSchema as { toJSONSchema(): Record<string, unknown> }
  ).toJSONSchema() as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  // 2. Get action input IDs (credentials excluded) - reuse existing function!
  const actionInputIds = getActionInputIds(component);
  const exposedParamIds = getExposedParameterIds(component);

  // 3. Filter properties to only include action inputs
  const filteredProperties = pick(
    (fullSchema.properties ?? {}) as Record<string, unknown>,
    actionInputIds
  );

  // 4. Filter required array
  const filteredRequired = (fullSchema.required ?? []).filter((id: string) =>
    actionInputIds.includes(id)
  );

  // 5. Add descriptions from port metadata
  const inputs = extractPorts(component.inputs);
  for (const input of inputs) {
    if (actionInputIds.includes(input.id)) {
      const prop = filteredProperties[input.id] as Record<string, unknown> | undefined;
      if (prop && !prop.description && (input.description ?? input.label)) {
        prop.description = input.description ?? input.label;
      }
    }
  }

  // 6. Add exposed parameters (if any)
  if (parametersSchema && exposedParamIds.length > 0) {
    const paramSchema = (
      parametersSchema as { toJSONSchema(): Record<string, unknown> }
    ).toJSONSchema() as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    const paramProperties = pick(
      (paramSchema.properties ?? {}) as Record<string, unknown>,
      exposedParamIds
    );

    const paramRequired = (paramSchema.required ?? []).filter((id: string) =>
      exposedParamIds.includes(id)
    );

    // Avoid collisions: inputs take precedence
    for (const [key, value] of Object.entries(paramProperties)) {
      if (!(key in filteredProperties)) {
        filteredProperties[key] = value;
      }
    }

    const requiredSet = new Set(filteredRequired);
    for (const id of paramRequired) {
      if (!(id in filteredProperties)) {
        continue;
      }
      requiredSet.add(id);
    }

    // Add descriptions from parameter metadata when missing
    const paramShape = getObjectShape(parametersSchema);
    if (paramShape) {
      for (const id of exposedParamIds) {
        if (!(id in filteredProperties)) {
          continue;
        }
        const prop = filteredProperties[id] as Record<string, unknown> | undefined;
        if (!prop || prop.description) {
          continue;
        }
        const meta = getParamMeta(paramShape[id] as any);
        if (meta?.description ?? meta?.label) {
          prop.description = meta?.description ?? meta?.label;
        }
      }
    }

    return {
      type: 'object' as const,
      properties: filteredProperties as Record<string, object>,
      required: Array.from(requiredSet),
    };
  }

  return {
    type: 'object' as const,
    properties: filteredProperties as Record<string, object>,
    required: filteredRequired,
  };
}

/**
 * Get the tool name for a component.
 * Uses agentTool.toolName if specified, otherwise derives from component slug.
 */
export function getToolName(component: ComponentDefinition): string {
  if (component.ui?.agentTool?.toolName) {
    return component.ui.agentTool.toolName;
  }

  // Derive from slug: 'abuseipdb-lookup' → 'abuseipdb_lookup'
  const slug = component.ui?.slug ?? component.id;
  return slug.replace(/-/g, '_').replace(/\./g, '_');
}

/**
 * Get the tool description for a component.
 * Uses agentTool.toolDescription if specified, otherwise uses component docs/description.
 */
export function getToolDescription(component: ComponentDefinition): string {
  if (component.ui?.agentTool?.toolDescription) {
    return component.ui.agentTool.toolDescription;
  }

  return component.ui?.description ?? component.docs ?? component.label;
}

/**
 * Get complete tool metadata for MCP tools/list response.
 */
export function getToolMetadata(component: ComponentDefinition): ToolMetadata {
  return {
    name: getToolName(component),
    description: getToolDescription(component),
    inputSchema: getToolSchema(component),
  };
}
