import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
} from '@shipsec/component-sdk';

const inputSchema = inputs({});

const outputSchema = outputs({});

const parameterSchema = parameters({
  content: param(z.string().default('').describe('Markdown content for notes and documentation'), {
    label: 'Content',
    editor: 'textarea',
    placeholder: 'Add your notes here... Supports **Markdown**!',
    description: 'Markdown content for notes and documentation',
    rows: 10,
    helpText: 'Supports GitHub Flavored Markdown including checklists, tables, and code blocks',
  }),
});

const definition = defineComponent({
  id: 'core.ui.text',
  label: 'Text',
  category: 'input',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Add markdown notes and documentation to your workflow. Supports GFM including checklists, tables, and code blocks.',
  ui: {
    slug: 'text-block',
    version: '1.0.0',
    type: 'input',
    category: 'input',
    description: 'Add markdown notes and documentation to your workflow',
    icon: 'FileText',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    // UI-only component - should not be included in workflow execution
    uiOnly: true,
    examples: [
      'Add workflow documentation with markdown headings, lists, and code blocks',
      'Create task checklists to track progress: - [ ] Task 1\\n- [x] Task 2',
    ],
  },
  async execute(_payload, _context) {
    return {};
  },
});

componentRegistry.register(definition);

export default definition;
