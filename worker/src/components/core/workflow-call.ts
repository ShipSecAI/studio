import { z } from 'zod'
import { componentRegistry, port, type ComponentDefinition } from '@shipsec/component-sdk'

const runtimeInputDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().optional(),
    type: z.enum(['file', 'text', 'number', 'json', 'array', 'string']).optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strip()

const inputSchema = z
  .object({
    workflowId: z.string().uuid(),
    versionStrategy: z.enum(['latest', 'specific']).default('latest'),
    versionId: z.string().uuid().optional(),
    timeoutSeconds: z.number().int().positive().default(300),
    childRuntimeInputs: z.array(runtimeInputDefinitionSchema).optional(),
  })
  .passthrough()

type Input = z.infer<typeof inputSchema>

const outputSchema = z.object({
  result: z.record(z.string(), z.unknown()),
  childRunId: z.string(),
})

type Output = z.infer<typeof outputSchema>

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.workflow.call',
  label: 'Call Workflow',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Execute another workflow synchronously and use its outputs.',
  metadata: {
    slug: 'workflow-call',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Execute another workflow synchronously and use its outputs.',
    icon: 'GitBranch',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
    inputs: [],
    outputs: [
      {
        id: 'result',
        label: 'Result',
        dataType: port.json(),
      },
      {
        id: 'childRunId',
        label: 'Child Run ID',
        dataType: port.text(),
      },
    ],
    parameters: [
      {
        id: 'workflowId',
        label: 'Workflow',
        type: 'select',
        required: true,
        description: 'The workflow to execute',
        options: [],
      },
      {
        id: 'versionStrategy',
        label: 'Version',
        type: 'select',
        required: true,
        default: 'latest',
        options: [
          { label: 'Latest', value: 'latest' },
          { label: 'Specific', value: 'specific' },
        ],
      },
      {
        id: 'versionId',
        label: 'Specific Version ID',
        type: 'text',
        required: false,
        visibleWhen: { versionStrategy: 'specific' },
        description: 'Only used when versionStrategy is "specific"',
      },
      {
        id: 'timeoutSeconds',
        label: 'Timeout (seconds)',
        type: 'number',
        required: false,
        default: 300,
        min: 1,
      },
    ],
    examples: [
      'Use a reusable enrichment workflow inside a larger pipeline.',
    ],
  },
  resolvePorts(params) {
    const parsed = inputSchema.safeParse(params)
    const childRuntimeInputs = parsed.success ? parsed.data.childRuntimeInputs ?? [] : []
    const reservedIds = new Set([
      'workflowId',
      'versionStrategy',
      'versionId',
      'timeoutSeconds',
      'childRuntimeInputs',
      'childWorkflowName',
    ])

    const dynamicInputs = childRuntimeInputs
      .map((runtimeInput) => {
        const id = runtimeInput.id.trim()
        if (!id || reservedIds.has(id)) {
          return null
        }

        const label = runtimeInput.label?.trim() || id
        const runtimeType = (runtimeInput.type ?? 'text').toLowerCase()
        const portType = runtimeInputTypeToPort(runtimeType)

        return {
          id,
          label,
          required: runtimeInput.required ?? true,
          description: runtimeInput.description,
          dataType: portType,
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)

    return {
      inputs: dynamicInputs,
      outputs: definition.metadata?.outputs ?? [],
    }
  },
  async execute() {
    throw new Error(
      'core.workflow.call must be executed by the Temporal workflow orchestrator (shipsecWorkflowRun)',
    )
  },
}

componentRegistry.register(definition)

function runtimeInputTypeToPort(type: string) {
  switch (type) {
    case 'string':
    case 'text':
      return port.text()
    case 'number':
      return port.number({ coerceFrom: ['text'] })
    case 'boolean':
      return port.boolean({ coerceFrom: ['text'] })
    case 'file':
      return port.file()
    case 'json':
      return port.json()
    case 'array':
      return port.list(port.text())
    default:
      return port.any()
  }
}
