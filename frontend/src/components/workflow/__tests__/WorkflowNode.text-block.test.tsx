import { describe, it, beforeEach, afterEach, expect } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { ReactFlowProvider } from 'reactflow'
import { WorkflowNode } from '../WorkflowNode'
import { useComponentStore } from '@/store/componentStore'

const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: noopStorage,
    writable: true,
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
  })
}

const textBlockMetadata = {
  id: 'core.ui.text',
  slug: 'text-block',
  name: 'Text',
  version: '1.0.0',
  type: 'process',
  category: 'transform',
  categoryConfig: {
    label: '🔄 Transform',
    color: 'text-orange-600',
    description: 'Data processing, text manipulation, and formatting',
    emoji: '🔄',
  },
  description: 'Add contextual notes or instructions to the workflow without affecting data flow.',
  documentation: null,
  documentationUrl: null,
  icon: 'Type',
  logo: null,
  author: {
    name: 'ShipSecAI',
    type: 'shipsecai' as const,
  },
  isLatest: true,
  deprecated: false,
  example: null,
  runner: { kind: 'inline' as const },
  inputs: [],
  outputs: [],
  parameters: [
    {
      id: 'title',
      label: 'Title',
      type: 'text' as const,
      required: false,
      placeholder: 'Optional heading',
      description: 'Short heading shown in the node header. Defaults to the component name.',
    },
    {
      id: 'content',
      label: 'Text Content',
      type: 'textarea' as const,
      required: false,
      rows: 6,
      placeholder: 'Add your workflow notes here…',
      description: 'The body text displayed inside the node. Supports plain text.',
      helpText: 'Use this to document manual steps, reminders, or context for teammates.',
    },
  ],
  examples: [],
}

describe('WorkflowNode – text block rendering', () => {
  beforeEach(() => {
    useComponentStore.setState({
      components: { 'core.ui.text': textBlockMetadata },
      slugIndex: { 'text-block': 'core.ui.text' },
      loading: false,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders configured title and content inside the node body', () => {
    const nodeData = {
      label: 'Text',
      config: {},
      componentId: 'core.ui.text',
      componentSlug: 'text-block',
      componentVersion: '1.0.0',
      parameters: {
        title: 'Incident Checklist',
        content: 'Review the execution summary before approval.',
      },
      inputs: {},
      status: 'idle',
    }

    render(
      <ReactFlowProvider>
        <WorkflowNode
          id="node-1"
          data={nodeData as any}
          selected={false}
          type="workflow"
          xPos={0}
          yPos={0}
          dragging={false}
        />
      </ReactFlowProvider>
    )

    expect(screen.getByText('Incident Checklist')).toBeInTheDocument()
    expect(screen.getByTestId('text-block-content')).toHaveTextContent(
      'Review the execution summary before approval.'
    )
  })

  it('falls back to helper text when no content is provided', () => {
    const nodeData = {
      label: 'Text',
      config: {},
      componentId: 'core.ui.text',
      componentSlug: 'text-block',
      componentVersion: '1.0.0',
      parameters: {
        title: '',
        content: '   ',
      },
      inputs: {},
      status: 'idle',
    }

    render(
      <ReactFlowProvider>
        <WorkflowNode
          id="node-2"
          data={nodeData as any}
          selected={false}
          type="workflow"
          xPos={0}
          yPos={0}
          dragging={false}
        />
      </ReactFlowProvider>
    )

    expect(screen.getByText('Text')).toBeInTheDocument()
    expect(screen.getByTestId('text-block-content')).toHaveTextContent(
      'Add notes in the configuration panel to share context with teammates.'
    )
  })
})
