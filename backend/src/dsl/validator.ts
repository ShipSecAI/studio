import { ZodError, ZodIssue } from 'zod';

import { componentRegistry, type ComponentPortMetadata } from '@shipsec/component-sdk';

import type { WorkflowGraphDto } from '../workflows/dto/workflow-graph.dto';
import type { WorkflowAction, WorkflowDefinition } from './types';
import {
  ActionPortSnapshot,
  arePortDataTypesCompatible,
  createPlaceholderForPort,
  describePortDataType,
} from './port-utils';

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
  graph: WorkflowGraphDto,
  compiledDefinition: WorkflowDefinition,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const actionPorts = new Map<string, ActionPortSnapshot>();

  // 1. Validate all components exist
  for (const node of graph.nodes) {
    const component = componentRegistry.get(node.type);
    if (!component) {
      errors.push({
        node: node.id,
        field: 'type',
        message: `Unknown component type: ${node.type}`,
        severity: 'error',
        suggestion:
          'Available components: ' +
          componentRegistry
            .list()
            .map((entry) => entry.id)
            .join(', '),
      });
    }
  }

  // 2. Validate component parameters against schemas
  for (const action of compiledDefinition.actions) {
    const component = componentRegistry.get(action.componentId);
    if (!component) continue; // Already reported above

    const portSnapshot = resolveActionPortSnapshot(action, component);
    actionPorts.set(action.ref, portSnapshot);

    const paramsForValidation = { ...(action.params ?? {}) } as Record<string, unknown>;
    const placeholderFields = new Set<string>();

    for (const inputPort of portSnapshot.inputs) {
      const hasStaticValue =
        Object.prototype.hasOwnProperty.call(paramsForValidation, inputPort.id) &&
        paramsForValidation[inputPort.id] !== undefined;
      const hasMapping = Object.prototype.hasOwnProperty.call(action.inputMappings ?? {}, inputPort.id);

      if (!hasStaticValue && hasMapping) {
        paramsForValidation[inputPort.id] = createPlaceholderForPort(inputPort.dataType);
        placeholderFields.add(inputPort.id);
      }
    }

    const validation = component.inputSchema.safeParse(paramsForValidation);
    if (!validation.success) {
      const relevantIssues = validation.error.issues.filter(
        (issue) => !isPlaceholderIssue(issue, placeholderFields),
      );

      if (relevantIssues.length > 0) {
        const filteredError =
          relevantIssues.length === validation.error.issues.length
            ? validation.error
            : new ZodError(relevantIssues as ZodIssue[]);

        errors.push({
          node: action.ref,
          field: 'params',
          message: `Component parameter validation failed: ${filteredError.message}`,
          severity: 'error',
          suggestion: 'Check component schema for required parameters and correct types',
        });
      }
    }

    // 3. Validate secret parameter references
    validateSecretParameters(action, component, errors, warnings);
  }

  // 4. Validate input mappings
  validateInputMappings(graph, compiledDefinition, actionPorts, errors, warnings);

  // 5. Validate manual trigger runtime inputs configuration
  validateManualTriggerConfiguration(graph, compiledDefinition, errors, warnings);

  // 6. Validate edge type compatibility
  validateEdgeCompatibility(compiledDefinition, actionPorts, errors);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function isPlaceholderIssue(issue: ZodIssue, placeholderFields: Set<string>): boolean {
  const field = issue.path[0];
  if (typeof field !== 'string') {
    return false;
  }

  if (!placeholderFields.has(field)) {
    return false;
  }

  switch (issue.code) {
    case 'invalid_type':
      return true;
    case 'invalid_format':
      return true;
    case 'too_small':
      return true;
    case 'too_big':
      return true;
    case 'invalid_union':
      if ('unionErrors' in issue) {
        const unionIssue = issue as ZodIssue & { unionErrors: ZodError[] };
        return unionIssue.unionErrors.every((variant: ZodError) =>
          variant.issues.every((inner) => inner.code === 'invalid_type'),
        );
      }
      return false;
    default:
      return false;
  }
}

/**
 * Validate secret parameter references
 */
function validateSecretParameters(
  action: WorkflowAction,
  component: any,
  errors: ValidationError[],
  warnings: ValidationError[],
) {
  const secretParams = component.metadata?.parameters?.filter((p: any) => p.type === 'secret') || [];

  for (const secretParam of secretParams) {
    const paramValue = action.params?.[secretParam.id];

    const isRequired = secretParam.required !== false;

    if (!paramValue) {
      if (!isRequired) {
        continue;
      }
      errors.push({
        node: action.ref,
        field: secretParam.id,
        message: `Required secret parameter '${secretParam.label}' is missing`,
        severity: 'error',
        suggestion: 'Configure this parameter in the node configuration panel',
      });
    } else if (typeof paramValue === 'string' && !isValidSecretId(paramValue)) {
      // Check if it looks like a direct API key/value instead of a secret reference
      if (
        paramValue.length > 20 &&
        (paramValue.startsWith('AIza') ||
          paramValue.startsWith('sk-') ||
          /[A-Za-z0-9_-]{20,}/.test(paramValue))
      ) {
        errors.push({
          node: action.ref,
          field: secretParam.id,
          message: `Invalid secret reference: '${paramValue.substring(0, 10)}...' appears to be a direct API key value`,
          severity: 'error',
          suggestion:
            'Store your API key in the secrets manager and reference it by name instead of using the raw value',
        });
      } else {
        warnings.push({
          node: action.ref,
          field: secretParam.id,
          message: `Secret reference '${paramValue}' may not exist or may be malformed`,
          severity: 'warning',
          suggestion: 'Verify the secret exists in the secrets manager',
        });
      }
    }
  }
}

/**
 * Validate input mappings between nodes
 */
function validateInputMappings(
  graph: WorkflowGraphDto,
  compiledDefinition: WorkflowDefinition,
  actionPorts: Map<string, ActionPortSnapshot>,
  errors: ValidationError[],
  warnings: ValidationError[],
) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const action of compiledDefinition.actions) {
    const componentInputs = actionPorts.get(action.ref)?.inputs ?? [];

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
          suggestion:
            'Either provide a static value in node configuration or connect an edge to this input',
        });
      }
    }

    // Validate edge mappings point to valid nodes
    for (const [targetHandle, mapping] of Object.entries(action.inputMappings ?? {})) {
      const sourceNode = nodes.get(mapping.sourceRef);
      if (!sourceNode) {
        errors.push({
          node: action.ref,
          field: 'inputMappings',
          message: `Edge references unknown source node: ${mapping.sourceRef}`,
          severity: 'error',
          suggestion: 'Check that the source node exists and the edge is properly connected',
        });
      }
    }
  }
}

function validateEdgeCompatibility(
  compiledDefinition: WorkflowDefinition,
  actionPorts: Map<string, ActionPortSnapshot>,
  errors: ValidationError[],
) {
  const actions = new Map(compiledDefinition.actions.map((action) => [action.ref, action]));

  for (const edge of compiledDefinition.edges) {
    const sourceAction = actions.get(edge.sourceRef);
    const targetAction = actions.get(edge.targetRef);

    if (!sourceAction || !targetAction) {
      errors.push({
        node: edge.targetRef,
        field: 'inputMappings',
        message: `Edge references unknown action(s): ${edge.sourceRef} -> ${edge.targetRef}`,
        severity: 'error',
        suggestion: 'Ensure each edge points to a valid node',
      });
      continue;
    }

    const sourcePorts = actionPorts.get(sourceAction.ref);
    const targetPorts = actionPorts.get(targetAction.ref);

    if (!sourcePorts || !targetPorts) {
      errors.push({
        node: targetAction.ref,
        field: 'inputMappings',
        message: `Missing port metadata for ${edge.sourceRef} -> ${edge.targetRef}`,
        severity: 'error',
        suggestion: 'Verify component metadata exports both inputs and outputs',
      });
      continue;
    }

    const sourceHandle = edge.sourceHandle;
    const targetHandle = edge.targetHandle;

    if (!sourceHandle || !targetHandle) {
      // Control edge used for ordering only; skip type validation
      continue;
    }

    const sourcePort = sourcePorts.outputs.find((port) => port.id === sourceHandle);
    const targetPort = targetPorts.inputs.find((port) => port.id === targetHandle);

    if (!sourcePort) {
      errors.push({
        node: targetAction.ref,
        field: 'inputMappings',
        message: `Source port '${sourceHandle}' not found on ${edge.sourceRef}`,
        severity: 'error',
        suggestion: 'Confirm the source component exposes this output port',
      });
      continue;
    }

    if (!targetPort) {
      errors.push({
        node: targetAction.ref,
        field: 'inputMappings',
        message: `Target port '${targetHandle}' not found on ${edge.targetRef}`,
        severity: 'error',
        suggestion: 'Connect to a valid input port on the target component',
      });
      continue;
    }

    if (!sourcePort.dataType || !targetPort.dataType) {
      errors.push({
        node: targetAction.ref,
        field: 'inputMappings',
        message: `Missing port type metadata for ${edge.sourceRef}.${sourceHandle} -> ${edge.targetRef}.${targetHandle}`,
        severity: 'error',
        suggestion: 'Ensure both ports declare a data type',
      });
      continue;
    }

    if (!arePortDataTypesCompatible(sourcePort.dataType, targetPort.dataType)) {
      errors.push({
        node: targetAction.ref,
        field: 'inputMappings',
        message: `Type mismatch: ${describePortDataType(sourcePort.dataType)} cannot connect to ${describePortDataType(targetPort.dataType)}`,
        severity: 'error',
        suggestion: 'Use matching port types or add a transformer component',
      });
    }
  }
}

/**
 * Validate manual trigger runtime inputs configuration
 */
function validateManualTriggerConfiguration(
  _graph: WorkflowGraphDto,
  compiledDefinition: WorkflowDefinition,
  errors: ValidationError[],
  warnings: ValidationError[],
) {
  const manualTriggerActions = compiledDefinition.actions.filter(
    (action) => action.componentId === 'core.trigger.manual',
  );

  for (const action of manualTriggerActions) {
    const runtimeInputs = action.params?.runtimeInputs;

    if (!Array.isArray(runtimeInputs)) {
      errors.push({
        node: action.ref,
        field: 'runtimeInputs',
        message: 'Manual trigger requires runtimeInputs configuration',
        severity: 'error',
        suggestion: 'Configure runtime inputs to collect data when the workflow is triggered',
      });
    } else if (runtimeInputs.length === 0) {
      warnings.push({
        node: action.ref,
        field: 'runtimeInputs',
        message: 'Manual trigger has no runtime inputs configured',
        severity: 'warning',
        suggestion: 'Add runtime inputs if you need to collect data when the workflow is triggered',
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
            suggestion: 'Ensure each runtime input has id, label, and type fields',
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
  if (suspiciousPatterns.some((pattern) => pattern.test(secretId))) {
    return false;
  }

  // Valid secret IDs should be reasonable length and not look like raw secrets
  return secretId.length >= 3 && secretId.length <= 100 && !/[A-Za-z0-9_-]{30,}/.test(secretId);
}

function resolveActionPortSnapshot(
  action: WorkflowAction,
  component: any,
): ActionPortSnapshot {
  let inputs: ComponentPortMetadata[] = Array.isArray(component.metadata?.inputs)
    ? component.metadata.inputs.map((port: ComponentPortMetadata) => ({ ...port }))
    : [];

  let outputs: ComponentPortMetadata[] = Array.isArray(component.metadata?.outputs)
    ? component.metadata.outputs.map((port: ComponentPortMetadata) => ({ ...port }))
    : [];

  if (typeof component.resolvePorts === 'function') {
    const resolved = component.resolvePorts(action.params ?? {});
    if (Array.isArray(resolved?.inputs)) {
      inputs = resolved.inputs.map((port: ComponentPortMetadata) => ({ ...port }));
    }
    if (Array.isArray(resolved?.outputs)) {
      outputs = resolved.outputs.map((port: ComponentPortMetadata) => ({ ...port }));
    }
  }

  return { inputs, outputs };
}
