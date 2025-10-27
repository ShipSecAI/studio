import type { InputPort, PortDataType } from '@/schemas/component'

const primitiveLabelMap: Record<string, string> = {
  text: 'text',
  secret: 'secret',
  number: 'number',
  boolean: 'boolean',
  file: 'file',
  json: 'json',
}

const isPrimitive = (
  dataType: PortDataType,
): dataType is Extract<PortDataType, { kind: 'primitive' }> =>
  dataType.kind === 'primitive'

const isList = (
  dataType: PortDataType,
): dataType is Extract<PortDataType, { kind: 'list' }> =>
  dataType.kind === 'list'

const isMap = (
  dataType: PortDataType,
): dataType is Extract<PortDataType, { kind: 'map' }> =>
  dataType.kind === 'map'

const isContract = (
  dataType: PortDataType,
): dataType is Extract<PortDataType, { kind: 'contract' }> =>
  dataType.kind === 'contract'

const canCoercePrimitive = (
  source: Extract<PortDataType, { kind: 'primitive' }>,
  target: Extract<PortDataType, { kind: 'primitive' }>,
): boolean => {
  if (source.name === target.name) {
    return true
  }
  const allowed = target.coercion?.from ?? []
  return allowed.includes(source.name)
}

const comparePortDataTypes = (source: PortDataType, target: PortDataType): boolean => {
  if (isPrimitive(source) && isPrimitive(target)) {
    return canCoercePrimitive(source, target)
  }

  if (isContract(source) && isContract(target)) {
    return source.name === target.name
  }

  if (isList(source) && isList(target)) {
    return comparePortDataTypes(source.element, target.element)
  }

  if (isMap(source) && isMap(target)) {
    return comparePortDataTypes(source.value, target.value)
  }

  return false
}

export const arePortDataTypesCompatible = (
  source: PortDataType,
  target: PortDataType,
): boolean => comparePortDataTypes(source, target)

export const isTextLikePort = (dataType: PortDataType): boolean =>
  isPrimitive(dataType) && dataType.name === 'text'

export const describePortDataType = (dataType: PortDataType): string => {
  if (isPrimitive(dataType)) {
    return primitiveLabelMap[dataType.name] ?? dataType.name
  }

  if (isContract(dataType)) {
    return `contract:${dataType.name}`
  }

  if (isList(dataType)) {
    return `list<${describePortDataType(dataType.element)}>`
  }

  if (isMap(dataType)) {
    return `map<${describePortDataType(dataType.value)}>`
  }

  return 'unknown'
}

export const inputSupportsManualValue = (input: InputPort): boolean =>
  isTextLikePort(input.dataType)

export const runtimeInputTypeToPortDataType = (type: string): PortDataType => {
  const normalized = type.toLowerCase()
  switch (normalized) {
    case 'text':
    case 'string':
      return { kind: 'primitive', name: 'text' }
    case 'number':
      return { kind: 'primitive', name: 'number' }
    case 'boolean':
      return { kind: 'primitive', name: 'boolean' }
    case 'secret':
      return { kind: 'primitive', name: 'secret' }
    case 'file':
      return { kind: 'primitive', name: 'file' }
    case 'json':
      return { kind: 'primitive', name: 'json' }
    case 'array':
      return { kind: 'list', element: { kind: 'primitive', name: 'text' } }
    default:
      return { kind: 'primitive', name: 'text' }
  }
}
