import type {
  PrimitiveCoercionSource,
  PrimitivePortType,
  PrimitivePortTypeName,
  ContractPortType,
  ListPortType,
  MapPortType,
  PortDataType,
} from './types';

type PrimitiveOptions = {
  coerceFrom?: PrimitiveCoercionSource[];
};

function primitive(
  name: PrimitivePortTypeName,
  options: PrimitiveOptions = {},
): PrimitivePortType {
  const { coerceFrom } = options;
  return {
    kind: 'primitive',
    name,
    ...(coerceFrom && coerceFrom.length > 0
      ? { coercion: { from: coerceFrom } }
      : {}),
  };
}

function text(options: PrimitiveOptions = {}): PrimitivePortType {
  return primitive('text', {
    coerceFrom: options.coerceFrom ?? ['number', 'boolean'],
  });
}

function number(options: PrimitiveOptions = {}): PrimitivePortType {
  return primitive('number', {
    coerceFrom: options.coerceFrom ?? ['text'],
  });
}

function boolean(options: PrimitiveOptions = {}): PrimitivePortType {
  return primitive('boolean', {
    coerceFrom: options.coerceFrom ?? ['text'],
  });
}

function secret(options: PrimitiveOptions = {}): PrimitivePortType {
  return primitive('secret', options);
}

function file(): PrimitivePortType {
  return primitive('file');
}

function json(options: PrimitiveOptions = {}): PrimitivePortType {
  return primitive('json', options);
}

function list(element: PrimitivePortType | ContractPortType): ListPortType {
  return {
    kind: 'list',
    element,
  };
}

function map(value: PrimitivePortType): MapPortType {
  return {
    kind: 'map',
    value,
  };
}

function contract(name: string): ContractPortType {
  return {
    kind: 'contract',
    name,
  };
}

export const port = Object.freeze({
  primitive,
  text,
  number,
  boolean,
  secret,
  file,
  json,
  list,
  map,
  contract,
});

export type { PrimitiveOptions };

function isPrimitive(dataType: PortDataType): dataType is PrimitivePortType {
  return dataType.kind === 'primitive';
}

function isList(dataType: PortDataType): dataType is ListPortType {
  return dataType.kind === 'list';
}

function isMap(dataType: PortDataType): dataType is MapPortType {
  return dataType.kind === 'map';
}

function coercePrimitive(
  type: PrimitivePortType,
  value: unknown,
): { ok: boolean; value?: unknown; error?: string } {
  if (value === undefined || value === null) {
    return { ok: true, value };
  }

  switch (type.name) {
    case 'text': {
      if (typeof value === 'string') {
        return { ok: true, value };
      }
      const allowed = type.coercion?.from ?? [];
      if (typeof value === 'number' && allowed.includes('number')) {
        return { ok: true, value: value.toString() };
      }
      if (typeof value === 'boolean' && allowed.includes('boolean')) {
        return { ok: true, value: value.toString() };
      }
      return { ok: false, error: `Cannot coerce ${typeof value} to text` };
    }
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { ok: true, value };
      }
      const allowed = type.coercion?.from ?? [];
      if (typeof value === 'string' && allowed.includes('text')) {
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
      const allowed = type.coercion?.from ?? [];
      if (typeof value === 'string' && allowed.includes('text')) {
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
      return { ok: false, error: 'Secret values must be strings' };
    }
    case 'file':
    case 'json': {
      return { ok: true, value };
    }
    default: {
      return { ok: false, error: `Unsupported primitive type ${(type as any).name}` };
    }
  }
}

export function coerceValueForPort(
  dataType: PortDataType,
  value: unknown,
): { ok: boolean; value?: unknown; error?: string } {
  if (isPrimitive(dataType)) {
    return coercePrimitive(dataType, value);
  }

  if (dataType.kind === 'contract') {
    return { ok: true, value };
  }

  if (isList(dataType)) {
    if (!Array.isArray(value)) {
      return { ok: false, error: 'Expected array for list port' };
    }
    const coerced: unknown[] = [];
    for (const item of value) {
      const result = coerceValueForPort(dataType.element, item);
      if (!result.ok) {
        return { ok: false, error: result.error ?? 'Failed to coerce list item' };
      }
      coerced.push(result.value);
    }
    return { ok: true, value: coerced };
  }

  if (isMap(dataType)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Expected object for map port' };
    }
    const inputRecord = value as Record<string, unknown>;
    const coerced: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(inputRecord)) {
      const result = coercePrimitive(dataType.value, entry);
      if (!result.ok) {
        return { ok: false, error: result.error ?? `Failed to coerce value for key ${key}` };
      }
      coerced[key] = result.value;
    }
    return { ok: true, value: coerced };
  }

  return { ok: true, value };
}
