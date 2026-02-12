import {
  componentRegistry,
  extractPorts,
  type ComponentPortMetadata,
  type ComponentParameterMetadata,
} from '@shipsec/component-sdk';

type RegisteredComponent = NonNullable<ReturnType<typeof componentRegistry.get>>;

/**
 * Masks values based on a list of secret port definitions.
 */
function maskSecretPorts(secretPorts: { id: string }[], data: unknown): unknown {
  if (secretPorts.length === 0) {
    return data;
  }

  if (secretPorts.some((port) => port.id === '__self__')) {
    return '***';
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const clone = { ...(data as Record<string, unknown>) };
    for (const port of secretPorts) {
      if (Object.prototype.hasOwnProperty.call(clone, port.id)) {
        clone[port.id] = '***';
      }
    }
    return clone;
  }

  return '***';
}

/**
 * Identifies secret ports from a list of port definitions.
 */
function getSecretPorts(ports: ComponentPortMetadata[]): { id: string }[] {
  return ports.filter((port) => {
    if (port.editor === 'secret') {
      return true;
    }
    const connType = port.connectionType;
    if (!connType) {
      return false;
    }
    if (connType.kind === 'primitive') {
      return connType.name === 'secret';
    }
    if (connType.kind === 'contract') {
      return Boolean(connType.credential);
    }
    return false;
  });
}

/**
 * Masks inputs containing sensitive information (secrets) based on component port schemas.
 */
export function maskSecretInputs(component: RegisteredComponent, input: unknown): unknown {
  const inputPorts = extractPorts(component.inputs);
  const secretPorts = getSecretPorts(inputPorts);
  let masked = maskSecretPorts(secretPorts, input);

  if (component.parameters) {
    masked = maskSecretParameters(component, masked);
  }

  return masked;
}

function _getSecretParameters(_params: Record<string, any>): string[] {
  const secretKeys: string[] = [];
  // Since we don't have a direct helper like extractPorts for parameters yet that returns the metadata easily,
  // and they are branded Zod schemas, we can look at the internal metadata if available.
  // For now, we'll try to use the component's metadata if it's there.
  return secretKeys;
}

/**
 * Masks parameters containing sensitive information (secrets) based on component parameter schemas.
 */
export function maskSecretParameters(component: RegisteredComponent, params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return params;
  }

  // Extract parameter metadata safely
  const paramMetadata: ComponentParameterMetadata[] = [];
  try {
    const parameters = component.parameters as any;
    if (parameters && typeof parameters.shape === 'object') {
      for (const [key, field] of Object.entries(parameters.shape)) {
        const metadata = (field as any)._def?.shipsecMetadata;
        if (metadata?.editor === 'secret') {
          paramMetadata.push({ id: key, type: 'secret', label: key });
        }
      }
    }
  } catch (_e) {
    // Fallback if metadata extraction fails
  }

  const secretParamKeys = paramMetadata.filter((p) => p.type === 'secret').map((p) => p.id);

  if (secretParamKeys.length === 0) {
    return params;
  }

  const clone = { ...(params as Record<string, unknown>) };
  for (const key of secretParamKeys) {
    if (Object.prototype.hasOwnProperty.call(clone, key)) {
      clone[key] = '***';
    }
  }

  return clone;
}

/**
 * Masks outputs containing sensitive information (secrets) based on component port schemas.
 */
export function maskSecretOutputs(component: RegisteredComponent, output: unknown): unknown {
  const outputPorts = extractPorts(component.outputs);
  const secretPorts = getSecretPorts(outputPorts);

  if (secretPorts.length === 0) {
    return output;
  }

  if (secretPorts.some((port) => port.id === '__self__')) {
    return '***';
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const clone = { ...(output as Record<string, unknown>) };
    for (const port of secretPorts) {
      if (Object.prototype.hasOwnProperty.call(clone, port.id)) {
        clone[port.id] = '***';
      }
    }
    return clone;
  }

  return '***';
}

/**
 * Creates a lightweight summary of component output for trace events.
 * This avoids sending huge payloads over Kafka.
 */
export function createLightweightSummary(
  component: RegisteredComponent,
  output: unknown,
): Record<string, unknown> {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { _value: output } as any;
  }

  const obj = output as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  let hasTruncatedContent = false;

  // Copy summary field if it exists
  if (obj.summary) {
    summary.summary = obj.summary;
  }

  for (const [key, value] of Object.entries(obj)) {
    // Skip internal fields
    if (key.startsWith('__')) continue;
    if (key === 'summary') continue;

    if (Array.isArray(value)) {
      summary[`${key}Count`] = value.length;
      hasTruncatedContent = true;
    } else if (value !== null && typeof value === 'object') {
      // Nested objects are summarized if they have a summary, otherwise just marked as truncated
      if ((value as any).summary) {
        summary[key] = { summary: (value as any).summary, _truncated: true };
      }
      hasTruncatedContent = true;
    } else {
      // Primitives (string, number, boolean, null)
      summary[key] = value;
    }
  }

  // If output was already a spilled marker, preserve its metadata
  if (obj.__spilled__) {
    summary.__spilled__ = true;
    summary.storageRef = obj.storageRef;
    summary.originalSize = obj.originalSize;
    hasTruncatedContent = true;
  }

  if (hasTruncatedContent) {
    summary._truncated = true;
  }

  return summary;
}
