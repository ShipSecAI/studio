/**
 * Helper functions for working with agent-callable components (tool mode).
 */

import type {
  ComponentDefinition,
  ComponentPortMetadata,
  PortBindingType,
  AgentToolConfig,
} from './types';

/**
 * JSON Schema type for MCP tool input schema
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: unknown[];
    items?: unknown;
  }>;
  required: string[];
}

/**
 * Metadata for an agent-callable tool, suitable for MCP tools/list response
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
  return component.metadata?.agentTool?.enabled === true;
}

/**
 * Infer the binding type for a port based on its data type.
 * - secret, contract with credential flag → 'credential'
 * - everything else → 'action'
 */
export function inferBindingType(port: ComponentPortMetadata): PortBindingType {
  // Explicit binding type takes precedence
  if (port.bindingType) {
    return port.bindingType;
  }

  const dataType = port.dataType;

  // Secret ports are always credentials
  if (dataType.kind === 'primitive' && dataType.name === 'secret') {
    return 'credential';
  }

  // Contract ports with credential flag are credentials
  if (dataType.kind === 'contract' && dataType.credential) {
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
  const inputs = component.metadata?.inputs ?? [];
  return inputs
    .filter(input => inferBindingType(input) === 'credential')
    .map(input => input.id);
}

/**
 * Get the IDs of all action inputs for a component.
 * These are inputs that the agent provides at runtime.
 */
export function getActionInputIds(component: ComponentDefinition): string[] {
  const inputs = component.metadata?.inputs ?? [];
  return inputs
    .filter(input => inferBindingType(input) === 'action')
    .map(input => input.id);
}

/**
 * Convert a port data type to a JSON Schema type string.
 */
function portTypeToJsonSchemaType(port: ComponentPortMetadata): string {
  const dataType = port.dataType;

  if (dataType.kind === 'primitive') {
    switch (dataType.name) {
      case 'text':
      case 'secret':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'json':
      case 'any':
        return 'object';
      case 'file':
        return 'string'; // File path or URL
      default:
        return 'string';
    }
  }

  if (dataType.kind === 'list') {
    return 'array';
  }

  if (dataType.kind === 'map') {
    return 'object';
  }

  if (dataType.kind === 'contract') {
    return 'object';
  }

  return 'string';
}

/**
 * Get the JSON Schema for the action inputs only (inputs exposed to the agent).
 * This is used for the MCP tools/list inputSchema field.
 */
export function getToolSchema(component: ComponentDefinition): ToolInputSchema {
  const inputs = component.metadata?.inputs ?? [];
  const actionInputs = inputs.filter(input => inferBindingType(input) === 'action');

  const properties: ToolInputSchema['properties'] = {};
  const required: string[] = [];

  for (const input of actionInputs) {
    properties[input.id] = {
      type: portTypeToJsonSchemaType(input),
      description: input.description ?? input.label,
    };

    if (input.required) {
      required.push(input.id);
    }
  }

  return {
    type: 'object',
    properties,
    required,
  };
}

/**
 * Get the tool name for a component.
 * Uses agentTool.toolName if specified, otherwise derives from component slug.
 */
export function getToolName(component: ComponentDefinition): string {
  if (component.metadata?.agentTool?.toolName) {
    return component.metadata.agentTool.toolName;
  }

  // Derive from slug: 'abuseipdb-lookup' → 'abuseipdb_lookup'
  const slug = component.metadata?.slug ?? component.id;
  return slug.replace(/-/g, '_').replace(/\./g, '_');
}

/**
 * Get the tool description for a component.
 * Uses agentTool.toolDescription if specified, otherwise uses component docs/description.
 */
export function getToolDescription(component: ComponentDefinition): string {
  if (component.metadata?.agentTool?.toolDescription) {
    return component.metadata.agentTool.toolDescription;
  }

  return component.metadata?.description ?? component.docs ?? component.label;
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
