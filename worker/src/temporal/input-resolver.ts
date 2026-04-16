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

interface CoercionResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface SpilledDataMarker {
  __spilled__: true;
  storageRef: string;
  originalSize: number;
  [key: string]: unknown;
}

function isSpilledDataMarker(data: unknown): data is SpilledDataMarker {
  return (
    data !== null &&
    typeof data === 'object' &&
    (data as Record<string, unknown>)['__spilled__'] === true &&
    typeof (data as Record<string, unknown>)['storageRef'] === 'string'
  );
}

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
      if (!connectionType.element) {
        return { ok: false, error: 'Connection type element is null for list item' };
      }
      const result = coerceValueForConnectionType(connectionType.element, item);
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
      if (!connectionType.element) {
        return { ok: false, error: `Connection type element is null for key ${key}` };
      }
      const result = coerceValueForConnectionType(connectionType.element, entry);
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

interface ComponentInputMetadata {
  id: string;
  valuePriority?: 'manual-first' | 'connection-first' | string;
  connectionType: ConnectionType;
}

interface ComponentMetadataSnapshot {
  inputs?: ComponentInputMetadata[];
}

function getNestedValue(source: unknown, path: string[]): unknown {
  if (path.length === 0) return source;
  let current: unknown = source;
  for (const segment of path) {
    if (!segment) return undefined;
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return undefined;
  }
  return current;
}

function resolveTemplateExpression(
  expression: string,
  results: Map<string, unknown>,
): { resolved: boolean; value: unknown } {
  const segments = expression
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { resolved: false, value: undefined };
  }

  const [sourceRef, ...path] = segments;
  if (!results.has(sourceRef)) {
    return { resolved: false, value: undefined };
  }

  const sourceOutput = results.get(sourceRef);
  let value = getNestedValue(sourceOutput, path);

  // Back-compat: older compiled graphs reference entry.runtimeInputs.<id>, while
  // current entrypoint outputs are flattened as entry.<id>.
  if (
    value === undefined &&
    path.length >= 2 &&
    path[0] === 'runtimeInputs' &&
    sourceOutput &&
    typeof sourceOutput === 'object' &&
    !Array.isArray(sourceOutput) &&
    !Object.prototype.hasOwnProperty.call(sourceOutput, 'runtimeInputs')
  ) {
    value = getNestedValue(sourceOutput, path.slice(1));
  }

  return { resolved: true, value };
}

function resolveTemplatesInValue(value: unknown, results: Map<string, unknown>): unknown {
  if (typeof value === 'string') {
    const matches = Array.from(value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g));
    if (matches.length === 0) {
      return value;
    }

    const first = matches[0];
    const isSingleTemplate = first[0].length === value.length && first.index === 0;
    if (isSingleTemplate) {
      const resolved = resolveTemplateExpression(first[1], results);
      if (resolved.resolved) {
        return resolved.value;
      }
      return value;
    }

    let resolvedAny = false;
    const replaced = value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (fullMatch, rawExpr) => {
      const resolved = resolveTemplateExpression(rawExpr, results);
      if (!resolved.resolved) {
        return fullMatch;
      }
      resolvedAny = true;
      if (resolved.value === null || resolved.value === undefined) {
        return '';
      }
      if (typeof resolved.value === 'string') {
        return resolved.value;
      }
      return JSON.stringify(resolved.value);
    });

    return resolvedAny ? replaced : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplatesInValue(item, results));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      resolveTemplatesInValue(item, results),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

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

  const resolvedInputs = resolveTemplatesInValue(inputs, results) as Record<string, unknown>;
  const resolvedParams = resolveTemplatesInValue(params, results) as Record<string, unknown>;

  return { inputs: resolvedInputs, params: resolvedParams, warnings, manualOverrides };
}
