import { ComponentMetadata } from '@/schemas/component'

export const githubTriggerComponent: ComponentMetadata = {
  id: 'github.pr.trigger',
  slug: 'github-pr-trigger',
  name: 'GitHub PR Trigger',
  version: '1.0.0',
  type: 'trigger',
  category: 'input',
  categoryConfig: {
    label: 'Triggers',
    color: '#2563eb',
    description: 'Entrypoints that start workflows',
    emoji: '🛰️',
  },
  description: 'Starts a run from a GitHub pull_request event and provides PR metadata',
  icon: 'github',
  runner: { kind: 'inline' },
  inputs: [],
  outputs: [
    {
      id: 'repository',
      label: 'Repository',
      dataType: { kind: 'map', value: { kind: 'primitive', name: 'text' } },
      description: 'owner/name',
    },
    {
      id: 'prNumber',
      label: 'PR Number',
      dataType: { kind: 'primitive', name: 'number' },
    },
    {
      id: 'head',
      label: 'Head',
      dataType: { kind: 'map', value: { kind: 'primitive', name: 'text' } },
      description: 'sha and ref of the head',
    },
    {
      id: 'base',
      label: 'Base',
      dataType: { kind: 'map', value: { kind: 'primitive', name: 'text' } },
      description: 'sha and ref of the base',
    },
    {
      id: 'author',
      label: 'Author',
      dataType: { kind: 'primitive', name: 'text' },
    },
    {
      id: 'labels',
      label: 'Labels',
      dataType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
    {
      id: 'files',
      label: 'Files (optional)',
      dataType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
    {
      id: 'deliveryId',
      label: 'Delivery ID',
      dataType: { kind: 'primitive', name: 'text' },
    },
  ],
  parameters: [],
  examples: [],
}
