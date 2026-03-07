import type { components } from '../../../packages/backend-client/src/api-client';
import type { ConnectionType, InputPort, OutputPort } from '@/schemas/component';
import type { NodeConfig } from '@/schemas/node';

type ResolvePortsRequestDto = components['schemas']['ResolvePortsRequestDto'];
type ResolvePortsResponseDto = components['schemas']['ResolvePortsResponseDto'];
type ResolvePortsValue = ResolvePortsRequestDto[string];
type NodeConfigValue = NodeConfig['params'][string];
type GeneratedConnectionType = ResolvePortsResponseDto['inputs'][number]['connectionType'];

const DEFAULT_CONNECTION_TYPE: ConnectionType = { kind: 'primitive', name: 'text' };
const PORT_EDITORS = new Set<InputPort['editor']>([
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'multi-select',
  'json',
  'secret',
]);
const VALUE_PRIORITIES = new Set<InputPort['valuePriority']>(['manual-first', 'connection-first']);
const PRIMITIVE_PORT_NAMES = new Set([
  'any',
  'text',
  'secret',
  'number',
  'boolean',
  'file',
  'json',
]);

function isResolvePortsValue(value: NodeConfigValue): value is ResolvePortsValue {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return (
    value.every((item) => typeof item === 'string') ||
    value.every((item) => typeof item === 'number') ||
    value.every((item) => typeof item === 'boolean')
  );
}

function normalizeConnectionType(connectionType?: GeneratedConnectionType): ConnectionType {
  if (!connectionType) {
    return DEFAULT_CONNECTION_TYPE;
  }

  if (connectionType.kind === 'any') {
    return { kind: 'any' };
  }

  if (connectionType.kind === 'primitive' && connectionType.name) {
    return {
      kind: 'primitive',
      name: PRIMITIVE_PORT_NAMES.has(connectionType.name) ? connectionType.name : 'text',
    };
  }

  if (connectionType.kind === 'contract' && connectionType.name) {
    return {
      kind: 'contract',
      name: connectionType.name,
      ...(connectionType.credential !== undefined ? { credential: connectionType.credential } : {}),
    };
  }

  return DEFAULT_CONNECTION_TYPE;
}

function normalizeEditor(editor?: string): InputPort['editor'] {
  return editor && PORT_EDITORS.has(editor as InputPort['editor'])
    ? (editor as InputPort['editor'])
    : undefined;
}

function normalizeValuePriority(valuePriority?: string): InputPort['valuePriority'] {
  return valuePriority && VALUE_PRIORITIES.has(valuePriority as InputPort['valuePriority'])
    ? (valuePriority as InputPort['valuePriority'])
    : undefined;
}

export function toResolvePortsRequest(
  values: Record<string, NodeConfigValue>,
): ResolvePortsRequestDto {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) =>
      isResolvePortsValue(value) ? [[key, value]] : [],
    ),
  );
}

export function normalizeResolvedInputs(
  inputs: ResolvePortsResponseDto['inputs'] | undefined,
): InputPort[] {
  return (inputs ?? []).map((input) => ({
    id: input.id,
    label: input.label,
    connectionType: normalizeConnectionType(input.connectionType),
    ...(input.required !== undefined ? { required: input.required } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(normalizeEditor(input.editor) ? { editor: normalizeEditor(input.editor) } : {}),
    ...(normalizeValuePriority(input.valuePriority)
      ? { valuePriority: normalizeValuePriority(input.valuePriority) }
      : {}),
  }));
}

export function normalizeResolvedOutputs(
  outputs: ResolvePortsResponseDto['outputs'] | undefined,
): OutputPort[] {
  return (outputs ?? []).map((output) => ({
    id: output.id,
    label: output.label,
    connectionType: normalizeConnectionType(output.connectionType),
    ...(output.description ? { description: output.description } : {}),
  }));
}
