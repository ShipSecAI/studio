import { isSpilledDataMarker } from '@shipsec/component-sdk';
import type { ConnectionType } from '@shipsec/component-sdk/types';
import type { WorkflowAction } from './types';

export interface InputWarning {
  target: string;
  sourceRef: string;
  sourceHandle: string;
  [key: string]: unknown;
}

export interface ManualOverride {
  target: string;
}

type CoercionResult = { ok: boolean; value?: unknown; error?: string };

function coercePrimitiveValue(type: string | undefined, value: unknown): CoercionResult {
  if (value === undefined || value === null) {
    return { ok: true, value };
  }

  switch (type) {
    case 'text': {
      if (typeof value === 'string') {
        return { ok: true, value };
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: value.toString() };
      }
      return { ok: false, error: `Cannot coerce ${typeof value} to text` };
    }
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { ok: true, value };
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          return { ok: true, value: parsed };
        }
        return { ok: false, error: `Cannot parse "${value}" as number` };
      }
      return { ok: false, error: `Cannot coerce ${typeof value} to number` };
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return { ok: true, value };
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') {
          return { ok: true, value: true };
        }
        if (normalized === 'false') {
          return { ok: true, value: false };
        }
        return { ok: false, error: `Cannot parse "${value}" as boolean` };
      }
      return { ok: false, error: `Cannot coerce ${typeof value} to boolean` };
    }
    case 'secret': {
      if (typeof value === 'string') {
        return { ok: true, value };
      }
      if (typeof value === 'object') {
        try {
          return { ok: true, value: JSON.stringify(value) };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? `Secret value is not JSON-serializable: ${error.message}`
                : 'Secret value is not JSON-serializable',
          };
        }
      }
      return { ok: false, error: 'Secret values must be strings or JSON objects' };
    }
    case 'file':
    case 'json':
    case 'any':
    default:
      return { ok: true, value };
  }
}

function coerceValueForConnectionType(
  connectionType: ConnectionType,
  value: unknown,
): CoercionResult {
  if (connectionType.kind === 'primitive') {
    return coercePrimitiveValue(connectionType.name, value);
  }

  if (connectionType.kind === 'contract') {
    return { ok: true, value };
  }

  if (connectionType.kind === 'list') {
    if (!Array.isArray(value)) {
      return { ok: false, error: 'Expected array for list port' };
    }
    const coerced: unknown[] = [];
    for (const item of value) {
      const result = coerceValueForConnectionType(connectionType.element!, item);
      if (!result.ok) {
        return { ok: false, error: result.error ?? 'Failed to coerce list item' };
      }
      coerced.push(result.value);
    }
    return { ok: true, value: coerced };
  }

  if (connectionType.kind === 'map') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Expected object for map port' };
    }
    const inputRecord = value as Record<string, unknown>;
    const coerced: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(inputRecord)) {
      const result = coerceValueForConnectionType(connectionType.element!, entry);
      if (!result.ok) {
        return { ok: false, error: result.error ?? `Failed to coerce value for key ${key}` };
      }
      coerced[key] = result.value;
    }
    return { ok: true, value: coerced };
  }

  return { ok: true, value };
}

export function resolveInputValue(sourceOutput: unknown, sourceHandle: string): unknown {
  if (sourceOutput === null || sourceOutput === undefined) {
    return undefined;
  }

  if (sourceHandle === '__self__') {
    return sourceOutput;
  }

  if (typeof sourceOutput === 'object') {
    const record = sourceOutput as Record<string, unknown>;
    
    // If it's a spilled marker, we return the marker itself along with the sourceHandle
    // The activity will then be responsible for fetching the full data 
    // and extracting the specific handle.
    if (isSpilledDataMarker(sourceOutput)) {
      return {
        ...sourceOutput,
        __spilled_handle__: sourceHandle,
      };
    }


    if (Object.prototype.hasOwnProperty.call(record, sourceHandle)) {
      return record[sourceHandle];
    }
  }


  return undefined;
}


type ComponentInputMetadata = {
  id: string;
  valuePriority?: 'manual-first' | 'connection-first' | string;
  connectionType: ConnectionType;
};

type ComponentMetadataSnapshot = {
  inputs?: ComponentInputMetadata[];
};

export function buildActionPayload(
  action: WorkflowAction,
  results: Map<string, unknown>,
  options: {
    componentMetadata?: ComponentMetadataSnapshot;
  } = {},
): {
    inputs: Record<string, unknown>;
    params: Record<string, unknown>;
    warnings: InputWarning[];
    manualOverrides: ManualOverride[];
  } {
  const params = { ...(action.params ?? {}) } as Record<string, unknown>;
  const inputs = { ...(action.inputOverrides ?? {}) } as Record<string, unknown>;
  const warnings: InputWarning[] = [];
  const manualOverrides: ManualOverride[] = [];

  const inputMetadata = new Map(
    (options.componentMetadata?.inputs ?? []).map((port) => [port.id, port]),
  );

  for (const [targetKey, mapping] of Object.entries(action.inputMappings ?? {})) {
    const portMetadata = inputMetadata.get(targetKey);
    const preferManual = portMetadata?.valuePriority === 'manual-first';
    const manualProvided =
      preferManual && Object.prototype.hasOwnProperty.call(inputs, targetKey)
        ? inputs[targetKey] !== undefined
        : false;

    if (manualProvided) {
      manualOverrides.push({ target: targetKey });
      continue;
    }

    const sourceOutput = results.get(mapping.sourceRef);
    const resolved = resolveInputValue(sourceOutput, mapping.sourceHandle);

    if (resolved !== undefined) {
      if (portMetadata?.connectionType) {
        const coercion = coerceValueForConnectionType(portMetadata.connectionType, resolved);
        if (coercion.ok) {
          inputs[targetKey] = coercion.value;
        } else {
          warnings.push({
            target: targetKey,
            sourceRef: mapping.sourceRef,
            sourceHandle: mapping.sourceHandle,
          });
          continue;
        }
      } else {
        inputs[targetKey] = resolved;
      }
    } else {

      warnings.push({
        target: targetKey,
        sourceRef: mapping.sourceRef,
        sourceHandle: mapping.sourceHandle,
      });
    }
  }

  return { inputs, params, warnings, manualOverrides };
}
