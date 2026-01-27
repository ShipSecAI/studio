import type { ConnectionType, InputPort } from '@/schemas/component';

const primitiveLabelMap: Record<string, string> = {
  any: 'any',
  text: 'text',
  secret: 'secret',
  number: 'number',
  boolean: 'boolean',
  file: 'file',
  json: 'json',
};

type PortLike = ConnectionType | undefined;

const DEFAULT_TEXT_CONNECTION: ConnectionType = { kind: 'primitive', name: 'text' };

const normalizePortType = (portType: PortLike): ConnectionType =>
  portType ?? DEFAULT_TEXT_CONNECTION;

export const resolvePortType = (port: { connectionType?: ConnectionType }): ConnectionType =>
  normalizePortType(port.connectionType);

interface PrimitivePort {
  kind: 'primitive';
  name?: string;
}
interface ListPort {
  kind: 'list';
  element?: ConnectionType;
}
interface MapPort {
  kind: 'map';
  element?: ConnectionType;
}
interface ContractPort {
  kind: 'contract';
  name?: string;
  credential?: boolean;
}

const isPrimitive = (dataType: ConnectionType): dataType is PrimitivePort =>
  dataType?.kind === 'primitive';

const isList = (dataType: ConnectionType): dataType is ListPort => dataType?.kind === 'list';

const isMap = (dataType: ConnectionType): dataType is MapPort => dataType?.kind === 'map';

const isContract = (dataType: ConnectionType): dataType is ContractPort =>
  dataType?.kind === 'contract';

const canCoercePrimitive = (
  source: Extract<ConnectionType, { kind: 'primitive' }>,
  target: Extract<ConnectionType, { kind: 'primitive' }>,
): boolean => {
  if (source.name === target.name) {
    return true;
  }
  if (target.name === 'text' && (source.name === 'number' || source.name === 'boolean')) {
    return true;
  }
  if (target.name === 'number' && source.name === 'text') {
    return true;
  }
  if (target.name === 'boolean' && source.name === 'text') {
    return true;
  }
  return false;
};

const comparePortTypes = (source: ConnectionType, target: ConnectionType): boolean => {
  if (target.kind === 'any' || source.kind === 'any') {
    return true;
  }

  if (isPrimitive(source) && isPrimitive(target)) {
    return canCoercePrimitive(source, target);
  }

  if (isContract(source) && isContract(target)) {
    return source.name === target.name && source.credential === target.credential;
  }

  if (isList(source) && isList(target)) {
    return comparePortTypes(normalizePortType(source.element), normalizePortType(target.element));
  }

  if (isMap(source) && isMap(target)) {
    return comparePortTypes(normalizePortType(source.element), normalizePortType(target.element));
  }

  return false;
};

export const arePortTypesCompatible = (source: PortLike, target: PortLike): boolean =>
  comparePortTypes(normalizePortType(source), normalizePortType(target));

const isPrimitiveAnd = (dataType: ConnectionType, predicate: (name: string) => boolean): boolean =>
  isPrimitive(dataType) && predicate(dataType.name ?? 'text');

export const isTextLikePort = (dataType: PortLike): boolean =>
  isPrimitiveAnd(normalizePortType(dataType), (name) => name === 'text');

export const isListOfTextPort = (dataType: PortLike): boolean => {
  const normalized = normalizePortType(dataType);
  return (
    isList(normalized) &&
    normalized.element !== undefined &&
    isPrimitive(normalizePortType(normalized.element)) &&
    normalizePortType(normalized.element).name === 'text'
  );
};

export const describePortType = (dataType: PortLike): string => {
  const normalized = normalizePortType(dataType);

  if (normalized.kind === 'any') {
    return 'any';
  }

  if (isPrimitive(normalized)) {
    return primitiveLabelMap[normalized.name ?? 'text'] ?? normalized.name ?? 'text';
  }

  if (isContract(normalized)) {
    return normalized.credential ? `credential:${normalized.name}` : `contract:${normalized.name}`;
  }

  if (isList(normalized)) {
    return `list<${describePortType(normalized.element)}>`;
  }

  if (isMap(normalized)) {
    return `map<${describePortType(normalized.element)}>`;
  }

  return 'unknown';
};

export const inputSupportsManualValue = (input: InputPort): boolean => {
  const normalized = resolvePortType(input);
  const isSecret =
    input.editor === 'secret' || isPrimitiveAnd(normalized, (name) => name === 'secret');
  return (
    isPrimitiveAnd(
      normalized,
      (name) => name === 'text' || name === 'number' || name === 'boolean',
    ) ||
    isListOfTextPort(normalized) ||
    isSecret
  );
};

export const isCredentialInput = (input: InputPort): boolean => {
  const resolved = resolvePortType(input);
  return (
    (resolved.kind === 'contract' && resolved.credential) ||
    input.editor === 'secret' ||
    input.id === 'connection'
  );
};

export const runtimeInputTypeToConnectionType = (type: string): ConnectionType => {
  const normalized = type.toLowerCase();

  if (normalized === 'credential') {
    return { kind: 'contract', name: '__runtime.credential__', credential: true };
  }

  if (normalized.startsWith('credential:')) {
    const contractName = type.slice(type.indexOf(':') + 1).trim() || '__runtime.credential__';
    return { kind: 'contract', name: contractName, credential: true };
  }

  if (normalized.startsWith('contract:')) {
    const contractName = type.slice(type.indexOf(':') + 1).trim() || '__runtime.contract__';
    return { kind: 'contract', name: contractName };
  }

  switch (normalized) {
    case 'any':
      return { kind: 'any' };
    case 'text':
    case 'string':
      return { kind: 'primitive', name: 'text' };
    case 'number':
      return { kind: 'primitive', name: 'number' };
    case 'boolean':
      return { kind: 'primitive', name: 'boolean' };
    case 'secret':
      return { kind: 'primitive', name: 'secret' };
    case 'file':
      return { kind: 'primitive', name: 'file' };
    case 'json':
      return { kind: 'primitive', name: 'json' };
    case 'array':
      return { kind: 'list', element: { kind: 'primitive', name: 'text' } };
    default:
      return { kind: 'primitive', name: 'text' };
  }
};
