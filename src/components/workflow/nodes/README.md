# Workflow Components

This directory contains all workflow component definitions for the Security Workflow Builder.

## Directory Structure

```
nodes/
├── security-tools/      # Security scanning and enumeration tools
│   ├── Subfinder/
│   │   ├── Subfinder.spec.json
│   │   ├── Subfinder.tsx
│   │   └── README.md
│   └── ...
│
├── building-blocks/     # Data processing and transformation
│   ├── Merge/
│   │   ├── Merge.spec.json
│   │   ├── Merge.tsx
│   │   └── README.md
│   └── ...
│
├── input-output/        # Input and output components
│   ├── FileLoader/
│   │   ├── FileLoader.spec.json
│   │   ├── FileLoader.tsx
│   │   └── README.md
│   └── ...
│
├── registry.ts          # Component registry
├── types.ts             # Shared types
└── README.md           # This file
```

## Adding a New Component

### Step 1: Create Component Directory

Choose the appropriate category:
- `security-tools/` - For security scanning tools (e.g., Nmap, Nuclei)
- `building-blocks/` - For data processing (e.g., Filter, Split, Transform)
- `input-output/` - For I/O operations (e.g., Database, API, File)

Create a new directory under the chosen category:
```bash
mkdir -p src/components/workflow/nodes/{category}/{ComponentName}
```

### Step 2: Create Component Specification (`.spec.json`)

Create `{ComponentName}.spec.json` with the following structure:

```json
{
  "id": "uuid-here",
  "name": "Component Name",
  "slug": "component-slug",
  "version": "1.0.0",
  "category": "security-tool | building-block | input-output",
  "type": "input | scan | process | output",

  "author": {
    "name": "ShipSecAI",
    "type": "shipsecai"
  },

  "description": "Brief description (max 200 chars)",
  "documentation": "Detailed documentation...",
  "icon": "LucideIconName",

  "isLatest": true,
  "deprecated": false,

  "inputs": [
    {
      "id": "input-port-id",
      "label": "Input Port Label",
      "type": "string | array | object | file | any",
      "required": true,
      "description": "What this input accepts"
    }
  ],

  "outputs": [
    {
      "id": "output-port-id",
      "label": "Output Port Label",
      "type": "string | array | object | file | any",
      "description": "What this output produces",
      "format": "application/json"
    }
  ],

  "parameters": [
    {
      "id": "param-id",
      "label": "Parameter Label",
      "type": "text | number | boolean | select | multi-select | file",
      "required": false,
      "default": "default-value",
      "description": "Parameter description"
    }
  ],

  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

**Important:**
- Generate a new UUID for `id`
- `slug` must be lowercase with dashes (e.g., `my-component`)
- Use valid [Lucide icon names](https://lucide.dev/icons/) for `icon`
- Follow semantic versioning for `version`

### Step 3: Register Component

Add your component to `registry.ts`:

```typescript
// Import the spec
import myComponentSpec from './{category}/{ComponentName}/{ComponentName}.spec.json'

// Register it
registerComponent(myComponentSpec)
```

### Step 4: Create Component UI (Optional)

Create `{ComponentName}.tsx` for custom node rendering (if needed):

```typescript
import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { ComponentMetadata } from '@/schemas/component'

interface MyComponentProps {
  data: {
    component: ComponentMetadata
    // ... other node data
  }
}

export const MyComponent = memo(({ data }: MyComponentProps) => {
  return (
    <div className="p-4 border rounded-lg bg-white">
      {/* Custom rendering */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
})
```

### Step 5: Validate

Run validation to ensure your spec is correct:

```bash
pnpm run typecheck
```

### Step 6: Test

1. Start the dev server: `pnpm run dev`
2. Open the workflow builder
3. Your component should appear in the sidebar
4. Drag it onto the canvas
5. Verify ports and parameters display correctly

## Component Specification Reference

### Input/Output Port Types

- `string` - Single text value
- `array` - List of values
- `object` - JSON object
- `file` - File reference
- `any` - Accepts any type

### Parameter Types

- `text` - Text input field
- `number` - Number input with optional min/max
- `boolean` - Checkbox
- `select` - Dropdown (single selection)
- `multi-select` - Multi-select dropdown
- `file` - File upload

### Categories

- `security-tool` - Security scanning and enumeration
- `building-block` - Data processing utilities
- `input-output` - I/O operations

### Types

- `input` - Generates data (no inputs, has outputs)
- `scan` - Performs scanning (has inputs and outputs)
- `process` - Transforms data (has inputs and outputs)
- `output` - Consumes data (has inputs, no outputs)

## Best Practices

1. **Clear naming** - Use descriptive names and slugs
2. **Complete documentation** - Fill in all description fields
3. **Sensible defaults** - Provide good default values for parameters
4. **Validate types** - Ensure input/output types are compatible
5. **Test thoroughly** - Test all parameter combinations
6. **Version properly** - Follow semantic versioning

## Troubleshooting

### Component not showing in sidebar
- Check that it's registered in `registry.ts`
- Verify the JSON is valid
- Ensure all required fields are present

### Type validation errors
- Verify your spec matches `ComponentMetadataSchema`
- Check that all enums use valid values
- Run `pnpm run typecheck`

### Component not connecting
- Verify input/output types are compatible
- Check connection validation rules
- Ensure port IDs are unique within the component

## Examples

See existing components for reference:
- [Subfinder](./security-tools/Subfinder/Subfinder.spec.json) - Security tool example
- [FileLoader](./input-output/FileLoader/FileLoader.spec.json) - Input component example
- [Merge](./building-blocks/Merge/Merge.spec.json) - Building block example
