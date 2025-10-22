import type { WorkflowAction } from './types';

export interface InputWarning {
  target: string;
  sourceRef: string;
  sourceHandle: string;
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

export function buildActionParams(
  action: WorkflowAction,
  results: Map<string, unknown>,
): { params: Record<string, unknown>; warnings: InputWarning[] } {
  const params = { ...(action.params ?? {}) } as Record<string, unknown>;
  const warnings: InputWarning[] = [];

  for (const [targetKey, mapping] of Object.entries(action.inputMappings ?? {})) {
    const sourceOutput = results.get(mapping.sourceRef);
    const resolved = resolveInputValue(sourceOutput, mapping.sourceHandle);

    if (resolved !== undefined) {
      params[targetKey] = resolved;
    } else {
      warnings.push({
        target: targetKey,
        sourceRef: mapping.sourceRef,
        sourceHandle: mapping.sourceHandle,
      });
    }
  }

  return { params, warnings };
}

