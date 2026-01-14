import { componentRegistry } from '@shipsec/component-sdk';

type RegisteredComponent = NonNullable<ReturnType<typeof componentRegistry.get>>;

/**
 * Masks values based on a list of secret port definitions.
 */
function maskSecretPorts(
  secretPorts: Array<{ id: string }>,
  data: unknown
): unknown {
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
function getSecretPorts(
  ports: Array<{ id: string; dataType?: { kind: string; name?: string; credential?: boolean } }> | undefined
): Array<{ id: string }> {
  return (
    ports?.filter((port) => {
      if (!port.dataType) {
        return false;
      }
      if (port.dataType.kind === 'primitive') {
        return port.dataType.name === 'secret';
      }
      if (port.dataType.kind === 'contract') {
        return Boolean(port.dataType.credential);
      }
      return false;
    }) ?? []
  );
}

/**
 * Masks inputs containing sensitive information (secrets) based on component metadata.
 */
export function maskSecretInputs(component: RegisteredComponent, input: unknown): unknown {
  const secretPorts = getSecretPorts(component.metadata?.inputs);
  return maskSecretPorts(secretPorts, input);
}

/**
 * Masks outputs containing sensitive information (secrets) based on component metadata.
 */
export function maskSecretOutputs(component: RegisteredComponent, output: unknown): unknown {
  const secretPorts =
    component.metadata?.outputs?.filter((port) => {
      if (!port.dataType) {
        return false;
      }
      if (port.dataType.kind === 'primitive') {
        return port.dataType.name === 'secret';
      }
      if (port.dataType.kind === 'contract') {
        return Boolean(port.dataType.credential);
      }
      return false;
    }) ?? [];
    
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
export function createLightweightSummary(component: RegisteredComponent, output: unknown): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    
    // Copy summary field if it exists
    if (obj.summary) {
      summary.summary = obj.summary;
    }

    // Capture array lengths (common for findings)
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        summary[`${key}Count`] = value.length;
      }
    }

    // Add explicit truncated flag
    summary._truncated = true;
  }

  return summary;
}
