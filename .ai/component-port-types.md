# Component Port Type System (v2)

Last updated: 2024-07-06

## Goals

- Replace the ad-hoc string enum (`'string' | 'array' | …'`) with an explicit, self-documenting type contract.
- Make coercion rules visible and enforceable so builders know when conversions occur.
- Create a path for structured outputs without leaking arbitrary objects through ports.
- Keep ergonomics high for component authors (helpers + registry-backed contracts).

## Core Concepts

### Primitive Types

| Name    | Description                                     | Default coercion (`coerceFrom`)             |
|---------|-------------------------------------------------|---------------------------------------------|
| `text`  | UTF-8 string payloads                           | `['number', 'boolean']`                     |
| `secret`| Masked string values (never coerced)            | `[]`                                        |
| `number`| Numeric values (int/float)                      | `['text']` (via `parseFloat`)               |
| `boolean`| Boolean values                                 | `['text']` (truthy string check)            |
| `file`  | Structured file handle (id + metadata)          | `[]`                                        |
| `json`  | Arbitrary JSON payload                          | configurable per port                       |

### Collections

- `list<primitive|contract>`: Homogeneous arrays. Metadata is persisted as `{ kind: 'list', element: … }`.
- `map<primitive>`: String-keyed dictionaries with primitive values (`{ kind: 'map', value: … }`).

### Contracts

Structured data exits the component via a **named contract**:

```ts
registerContract({
  name: 'dnsx.v1',
  schema: z.object({
    host: z.string(),
    answers: z.record(z.string(), z.array(z.string())),
  }),
  summary: 'ProjectDiscovery dnsx response',
});
```

Ports reference the contract using `{ kind: 'contract', name: 'dnsx.v1' }`.
When an output references a contract, the workflow runner parses the payload with the registered Zod schema before the result is stored.

### Coercion Rules

- Defined on the *target* primitive (`coercion.from: PrimitiveTypeName[]`).
- Applied during input resolution before Zod validation.
- Conversions:
  - `text` ⇐ `number`/`boolean` via `.toString()`.
  - `number` ⇐ `text` via `parseFloat` (rejects `NaN`).
  - `boolean` ⇐ `text` via `['true','false']` (case insensitive).
  - Additional rules can be declared per port (`port.number({ coerceFrom: ['boolean'] })`).

## Authoring Helpers (`@shipsec/component-sdk`)

```ts
import { port, registerContract } from '@shipsec/component-sdk';

const definition = {
  metadata: {
    inputs: [
      { id: 'items', label: 'Items', dataType: port.list(port.text()) },
      { id: 'separator', label: 'Separator', dataType: port.text({ coerceFrom: [] }) },
    ],
    outputs: [
      { id: 'text', label: 'Joined Text', dataType: port.text() },
      { id: 'count', label: 'Item Count', dataType: port.number() },
    ],
  },
};
```

Helpers return fresh descriptors, so authors do not mutate shared instances accidentally.

## Validation Flow

1. **Connection validation (frontend)** uses the serialized `PortDataType` to check compatibility and planned coercions.
2. **Input resolver (worker)** resolves upstream values, applies coercions defined on the target port, and raises errors if conversion fails.
3. **Zod validation (component)** still runs (`component.inputSchema` + `component.outputSchema`).
4. **Contract enforcement** ensures structured outputs match registered schemas.

## Migration Notes

- Ports now use `dataType` instead of `type`.
- `ComponentPortMetadata` is shared between SDK, backend API, and UI.
- Existing workflows must be rewritten or migrated because the serialized metadata changes shape (no backwards compatibility promised for Phase 2).
- Update `docs/execution-contract.md` and component READMEs when introducing new contracts.
