import { coerceValueForPort } from '@shipsec/component-sdk/ports';
import type { PortDataType } from '@shipsec/component-sdk/types';
import type { WorkflowAction } from './types';

export interface InputWarning {
  target: string;
  sourceRef: string;
  sourceHandle: string;
}

export interface ManualOverride {
  target: string;
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
    if (Object.prototype.hasOwnProperty.call(record, sourceHandle)) {
      return record[sourceHandle];
    }
  }

  return undefined;
}

type ComponentInputMetadata = {
  id: string;
  valuePriority?: 'manual-first' | 'auto-first' | string;
  dataType?: PortDataType;
};

type ComponentMetadataSnapshot = {
  inputs?: ComponentInputMetadata[];
};

export function buildActionParams(
  action: WorkflowAction,
  results: Map<string, unknown>,
  options: {
    componentMetadata?: ComponentMetadataSnapshot;
  } = {},
): {
    params: Record<string, unknown>;
    warnings: InputWarning[];
    manualOverrides: ManualOverride[];
  } {
  const params = { ...(action.params ?? {}) } as Record<string, unknown>;
  const warnings: InputWarning[] = [];
  const manualOverrides: ManualOverride[] = [];

  const inputMetadata = new Map(
    (options.componentMetadata?.inputs ?? []).map((port) => [port.id, port]),
  );

  for (const [targetKey, mapping] of Object.entries(action.inputMappings ?? {})) {
    const portMetadata = inputMetadata.get(targetKey);
    const preferManual = portMetadata?.valuePriority === 'manual-first';
    const manualProvided =
      preferManual && Object.prototype.hasOwnProperty.call(params, targetKey)
        ? params[targetKey] !== undefined
        : false;

    if (manualProvided) {
      manualOverrides.push({ target: targetKey });
      continue;
    }

    const sourceOutput = results.get(mapping.sourceRef);
    const resolved = resolveInputValue(sourceOutput, mapping.sourceHandle);

    if (resolved !== undefined) {
      if (portMetadata?.dataType) {
        const coercion = coerceValueForPort(portMetadata.dataType, resolved);
        if (coercion.ok) {
          params[targetKey] = coercion.value;
        } else {
          warnings.push({
            target: targetKey,
            sourceRef: mapping.sourceRef,
            sourceHandle: mapping.sourceHandle,
          });
          continue;
        }
      } else {
        params[targetKey] = resolved;
      }
    } else {
      warnings.push({
        target: targetKey,
        sourceRef: mapping.sourceRef,
        sourceHandle: mapping.sourceHandle,
      });
    }
  }

  return { params, warnings, manualOverrides };
}
