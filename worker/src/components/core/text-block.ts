import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

const inputSchema = z.object({
  content: z.string().default('').describe('Markdown content for notes and documentation'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.void();

const definition: ComponentDefinition<Input, void> = {
  id: 'core.ui.text',
  label: 'Text',
  category: 'input',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Add markdown notes and documentation to your workflow. Supports GFM including checklists, tables, and code blocks.',
  metadata: {
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
    inputs: [],
    outputs: [],
    // UI-only component - should not be included in workflow execution
    uiOnly: true,
    parameters: [
      {
        id: 'content',
        label: 'Content',
        type: 'textarea',
        required: false,
        default: '',
        placeholder: 'Add your notes here... Supports **Markdown**!',
        description: 'Markdown content for notes and documentation',
        rows: 10,
        helpText: 'Supports GitHub Flavored Markdown including checklists, tables, and code blocks',
      },
    ],
    examples: [
      'Add workflow documentation with markdown headings, lists, and code blocks',
      'Create task checklists to track progress: - [ ] Task 1\\n- [x] Task 2',
    ],
  },
  async execute() {
    // Documentation component - no output
  },
};

componentRegistry.register(definition);

export default definition;
