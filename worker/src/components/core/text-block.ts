import { z } from 'zod'
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk'

const inputSchema = z.object({
  title: z
    .string()
    .max(120, 'Title must be 120 characters or fewer')
    .default('')
    .describe('Optional title displayed in the node header'),
  content: z
    .string()
    .default('')
    .describe('Text content to display inside the workflow canvas'),
})

type Input = z.infer<typeof inputSchema>

type Output = Record<string, never>

const outputSchema = z.object({}).strict()

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.ui.text',
  label: 'Text',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Displays helper text directly on the workflow canvas for human operators.',
  metadata: {
    slug: 'text-block',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Add contextual notes or instructions to the workflow without affecting data flow.',
    icon: 'Type',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [],
    outputs: [],
    parameters: [
      {
        id: 'title',
        label: 'Title',
        type: 'text',
        required: false,
        placeholder: 'Optional heading',
        description: 'Short heading shown in the node header. Defaults to the component name.',
      },
      {
        id: 'content',
        label: 'Text Content',
        type: 'textarea',
        required: false,
        rows: 6,
        placeholder: 'Add your workflow notes here…',
        description: 'The body text displayed inside the node. Supports plain text.',
        helpText: 'Use this to document manual steps, reminders, or context for teammates.',
      },
    ],
    examples: [
      'Explain how to triage workflow results before running downstream automation.',
      'Document manual approval steps that must be completed outside of ShipSec Studio.',
    ],
  },
  async execute(params, context) {
    const safeTitle = params.title?.trim()
    const safeContent = params.content?.trim()

    context.logger.info('[TextBlock] Rendering note component', {
      title: safeTitle,
      contentLength: safeContent.length,
    })

    if (safeContent) {
      context.emitProgress({
        message: `Displayed text note${safeTitle ? `: ${safeTitle}` : ''}`,
        level: 'info',
        data: {
          preview: safeContent.slice(0, 120),
        },
      })
    }

    return {}
  },
}

componentRegistry.register(definition)

export type { Input as TextBlockInput, Output as TextBlockOutput }
