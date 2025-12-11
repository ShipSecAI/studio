import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { useComponentStore } from '../componentStore'
import type { ComponentMetadata } from '@/schemas/component'

const mockComponents: ComponentMetadata[] = [
  {
    id: 'core.workflow.entrypoint',
    slug: 'entry-point',
    name: 'Entry Point',
    version: '2.0.0',
    type: 'trigger',
    category: 'input',
    categoryConfig: {
      label: '📥 Input',
      color: 'text-blue-600',
      description: 'Data sources, triggers, and credential access',
      emoji: '📥'
    },
    description: '',
    documentation: null,
    documentationUrl: null,
    icon: 'Play',
    logo: null,
    author: null,
    isLatest: true,
    deprecated: false,
    example: null,
    runner: { kind: 'inline' },
    inputs: [],
    outputs: [],
    parameters: [],
    examples: [],
  },
  {
    id: 'shipsec.subfinder.run',
    slug: 'subfinder',
    name: 'Subfinder',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    categoryConfig: {
      label: '🔒 Security Tools',
      color: 'text-red-600',
      description: 'Security scanning and assessment tools',
      emoji: '🔒'
    },
    description: '',
    documentation: null,
    documentationUrl: null,
    icon: 'Radar',
    logo: null,
    author: null,
    isLatest: true,
    deprecated: false,
    example: null,
    runner: { kind: 'docker' },
    inputs: [],
    outputs: [],
    parameters: [],
    examples: [],
  },
  {
    id: 'shipsec.httpx.scan',
    slug: 'httpx',
    name: 'httpx Web Probe',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    categoryConfig: {
      label: '🔒 Security Tools',
      color: 'text-red-600',
      description: 'Security scanning and assessment tools',
      emoji: '🔒'
    },
    description: '',
    documentation: null,
    documentationUrl: null,
    icon: 'Globe',
    logo: null,
    author: null,
    isLatest: true,
    deprecated: false,
    example: null,
    runner: { kind: 'docker' },
    inputs: [],
    outputs: [],
    parameters: [],
    examples: [],
  },
]

const listComponentsMock = mock(async () => mockComponents)

mock.module('@/services/api', () => ({
  api: {
    components: {
      list: listComponentsMock,
    },
  },
}))

describe('componentStore', () => {
  beforeEach(() => {
    useComponentStore.setState({
      components: {},
      slugIndex: {},
      loading: false,
      error: null,
    })
  })

  it('loads security scan components including httpx from the API', async () => {
    await useComponentStore.getState().fetchComponents()

    const scanComponents = useComponentStore.getState().getComponentsByType('scan')
    const scanSlugs = scanComponents.map((component) => component.slug)

    expect(scanSlugs).toContain('httpx')
  })
})
