import { WorkflowGraph, WorkflowNode } from '../workflows/dto/workflow-graph.dto';
import { WorkflowAction, WorkflowDefinition } from './types';
import { componentRegistry } from '@shipsec/component-sdk';

export interface ValidationError {
  node: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Comprehensive DSL validation for workflow graphs
 */
export function validateWorkflowGraph(
  graph: WorkflowGraph,
  compiledDefinition: WorkflowDefinition
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // 1. Validate all components exist
  for (const node of graph.nodes) {
    const component = componentRegistry.get(node.type);
    if (!component) {
      errors.push({
        node: node.id,
        field: 'type',
        message: `Unknown component type: ${node.type}`,
        severity: 'error',
        suggestion: 'Available components: ' + Array.from(componentRegistry.keys()).join(', ')
      });
    }
  }

  // 2. Validate component parameters against schemas
  for (const action of compiledDefinition.actions) {
    const component = componentRegistry.get(action.componentId);
    if (!component) continue; // Already caught above

    try {
      component.inputSchema.parse(action.params);
    } catch (error) {
      errors.push({
        node: action.ref,
        field: 'params',
        message: `Component parameter validation failed: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        suggestion: 'Check component schema for required parameters and correct types'
      });
    }

    // 3. Validate secret parameter references
    validateSecretParameters(action, component, errors, warnings);
  }

  // 4. Validate input mappings
  validateInputMappings(graph, compiledDefinition, errors, warnings);

  // 5. Validate manual trigger runtime inputs configuration
  validateManualTriggerConfiguration(graph, compiledDefinition, errors, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate secret parameter references
 */
function validateSecretParameters(
  action: WorkflowAction,
  component: any,
  errors: ValidationError[],
  warnings: ValidationError[]
) {
  const secretParams = component.metadata?.parameters?.filter((p: any) => p.type === 'secret') || [];

  for (const secretParam of secretParams) {
    const paramValue = action.params?.[secretParam.id];

    if (!paramValue) {
      errors.push({
        node: action.ref,
        field: secretParam.id,
        message: `Required secret parameter '${secretParam.label}' is missing`,
        severity: 'error',
        suggestion: 'Configure this parameter in the node configuration panel'
      });
    } else if (typeof paramValue === 'string' && !isValidSecretId(paramValue)) {
      // Check if it looks like a direct API key/value instead of a secret reference
      if (paramValue.length > 20 && (paramValue.startsWith('AIza') || paramValue.startsWith('sk-') || /[A-Za-z0-9_-]{20,}/.test(paramValue))) {
        errors.push({
          node: action.ref,
          field: secretParam.id,
          message: `Invalid secret reference: '${paramValue.substring(0, 10)}...' appears to be a direct API key value`,
          severity: 'error',
          suggestion: 'Store your API key in the secrets manager and reference it by name instead of using the raw value'
        });
      } else {
        warnings.push({
          node: action.ref,
          field: secretParam.id,
          message: `Secret reference '${paramValue}' may not exist or may be malformed`,
          severity: 'warning',
          suggestion: 'Verify the secret exists in the secrets manager'
        });
      }
    }
  }
}

/**
 * Validate input mappings between nodes
 */
function validateInputMappings(
  graph: WorkflowGraph,
  compiledDefinition: WorkflowDefinition,
  errors: ValidationError[],
  warnings: ValidationError[]
) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));

  for (const action of compiledDefinition.actions) {
    const component = componentRegistry.get(action.componentId);
    if (!component) continue;

    const componentInputs = component.metadata?.inputs || [];

    // Check if all required inputs have mappings or static values
    for (const input of componentInputs) {
      const hasStaticValue = action.params?.hasOwnProperty(input.id);
      const hasMapping = action.inputMappings?.hasOwnProperty(input.id);

      if (input.required && !hasStaticValue && !hasMapping) {
        errors.push({
          node: action.ref,
          field: 'inputMappings',
          message: `Required input '${input.label}' (${input.id}) has no mapping or static value`,
          severity: 'error',
          suggestion: 'Either provide a static value in node configuration or connect an edge to this input'
        });
      }
    }

    // Validate edge mappings point to valid nodes
    for (const [targetHandle, mapping] of Object.entries(action.inputMappings || {})) {
      const sourceNode = nodes.get(mapping.sourceRef);
      if (!sourceNode) {
        errors.push({
          node: action.ref,
          field: 'inputMappings',
          message: `Edge references unknown source node: ${mapping.sourceRef}`,
          severity: 'error',
          suggestion: 'Check that the source node exists and the edge is properly connected'
        });
      }
    }
  }
}

/**
 * Validate manual trigger runtime inputs configuration
 */
function validateManualTriggerConfiguration(
  graph: WorkflowGraph,
  compiledDefinition: WorkflowDefinition,
  errors: ValidationError[],
  warnings: ValidationError[]
) {
  const manualTriggerActions = compiledDefinition.actions.filter(action => action.componentId === 'core.trigger.manual');

  for (const action of manualTriggerActions) {
    const runtimeInputs = action.params?.runtimeInputs;

    if (!Array.isArray(runtimeInputs)) {
      errors.push({
        node: action.ref,
        field: 'runtimeInputs',
        message: 'Manual trigger requires runtimeInputs configuration',
        severity: 'error',
        suggestion: 'Configure runtime inputs to collect data when the workflow is triggered'
      });
    } else if (runtimeInputs.length === 0) {
      warnings.push({
        node: action.ref,
        field: 'runtimeInputs',
        message: 'Manual trigger has no runtime inputs configured',
        severity: 'warning',
        suggestion: 'Add runtime inputs if you need to collect data when the workflow is triggered'
      });
    } else {
      // Validate runtime input definitions
      for (const runtimeInput of runtimeInputs) {
        if (!runtimeInput.id || !runtimeInput.label || !runtimeInput.type) {
          errors.push({
            node: action.ref,
            field: 'runtimeInputs',
            message: 'Runtime input definition missing required fields (id, label, type)',
            severity: 'error',
            suggestion: 'Ensure each runtime input has id, label, and type fields'
          });
        }
      }
    }
  }
}

/**
 * Check if a string looks like a valid secret ID (not a raw secret value)
 */
function isValidSecretId(secretId: string): boolean {
  // Secret IDs should be reasonable-length identifiers, not raw secret values
  // Reject common patterns that suggest raw API keys or secrets
  const suspiciousPatterns = [
    /^AIza[A-Za-z0-9_-]{35}$/, // Google API keys
    /^sk-[A-Za-z0-9]{48}$/, // Stripe keys
    /^[A-Za-z0-9]{32,}$/, // Generic long alphanumeric strings
    /^ghp_[A-Za-z0-9]{36}$/, // GitHub PATs
    /^xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]{24}$/, // Slack bot tokens
  ];

  // If it matches suspicious patterns, it's probably a raw secret
  if (suspiciousPatterns.some(pattern => pattern.test(secretId))) {
    return false;
  }

  // Valid secret IDs should be reasonable length and not look like raw secrets
  return secretId.length >= 3 && secretId.length <= 100 && !/[A-Za-z0-9_-]{30,}/.test(secretId);
}

export { ValidationError, ValidationResult };