import type { ComponentPortMetadata, PortDataType } from '@shipsec/component-sdk';

type PrimitivePort = Extract<PortDataType, { kind: 'primitive' }>;
type ListPort = Extract<PortDataType, { kind: 'list' }>;
type MapPort = Extract<PortDataType, { kind: 'map' }>;
type ContractPort = Extract<PortDataType, { kind: 'contract' }>;

function isPrimitive(dataType: PortDataType): dataType is PrimitivePort {
  return dataType.kind === 'primitive';
}

function isList(dataType: PortDataType): dataType is ListPort {
  return dataType.kind === 'list';
}

function isMap(dataType: PortDataType): dataType is MapPort {
  return dataType.kind === 'map';
}

function isContract(dataType: PortDataType): dataType is ContractPort {
  return dataType.kind === 'contract';
}

function canCoercePrimitive(source: PrimitivePort, target: PrimitivePort): boolean {
  if (source.name === target.name) {
    return true;
  }

  // 'secret' and 'file' types cannot be coerced from other types
  if (source.name === 'secret' || source.name === 'file') {
    return false;
  }

  const allowed = target.coercion?.from ?? [];
  return allowed.includes(source.name);
}

function comparePortDataTypes(source: PortDataType, target: PortDataType): boolean {
  if (isPrimitive(target) && target.name === 'any') {
    return true;
  }

  if (isPrimitive(source) && source.name === 'any') {
    return true;
  }

  if (isPrimitive(source) && isPrimitive(target)) {
    return canCoercePrimitive(source, target);
  }

  if (isContract(source) && isContract(target)) {
    return source.name === target.name;
  }

  if (isList(source) && isList(target)) {
    return comparePortDataTypes(source.element, target.element);
  }

  if (isMap(source) && isMap(target)) {
    return comparePortDataTypes(source.value, target.value);
  }

  return false;
}

export function arePortDataTypesCompatible(source: PortDataType, target: PortDataType): boolean {
  return comparePortDataTypes(source, target);
}

export function describePortDataType(dataType: PortDataType): string {
  if (isPrimitive(dataType)) {
    return dataType.name;
  }

  if (isContract(dataType)) {
    return dataType.credential ? `credential:${dataType.name}` : `contract:${dataType.name}`;
  }

  if (isList(dataType)) {
    return `list<${describePortDataType(dataType.element)}>`;
  }

  if (isMap(dataType)) {
    return `map<${describePortDataType(dataType.value)}>`;
  }

  return 'unknown';
}

export function runtimeInputTypeToPortDataType(type: string): PortDataType {
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
      return { kind: 'primitive', name: 'any' };
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
}

export type ActionPortSnapshot = {
  inputs: ComponentPortMetadata[];
  outputs: ComponentPortMetadata[];
};

export function createPlaceholderForPort(dataType?: PortDataType): unknown {
  if (!dataType) {
    return null;
  }

  if (isPrimitive(dataType)) {
    switch (dataType.name) {
      case 'text':
        return '__placeholder__';
      case 'secret':
        return 'secret-placeholder';
      case 'number':
        return 1;
      case 'boolean':
        return false;
      case 'file':
        return {};
      case 'json':
        return {};
      case 'any':
        return null;
      default:
        return null;
    }
  }

  if (isList(dataType)) {
    return [createPlaceholderForPort(dataType.element)];
  }

  if (isMap(dataType)) {
    return { placeholder: createPlaceholderForPort(dataType.value) };
  }

  // Contract types vary per component; use empty object as best effort placeholder
  if (isContract(dataType)) {
    return dataType.credential ? 'credential-placeholder' : {};
  }

  return null;
}
