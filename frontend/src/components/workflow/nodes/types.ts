import type { ComponentMetadata } from '@/schemas/component'

/**
 * Component category display configuration
 */
export interface CategoryConfig {
  label: string
  description: string
  icon: string
}

export const CATEGORY_CONFIGS: Record<
  ComponentMetadata['category'],
  CategoryConfig
> = {
  'security-tool': {
    label: 'Security Tools',
    description: 'Security scanning and enumeration tools',
    icon: 'Shield',
  },
  'building-block': {
    label: 'Building Blocks',
    description: 'Data processing and transformation utilities',
    icon: 'Blocks',
  },
  'input-output': {
    label: 'Input/Output',
    description: 'Data input and output components',
    icon: 'FileJson',
  },
  trigger: {
    label: 'Triggers',
    description: 'Workflow entrypoint components',
    icon: 'Play',
  },
}

/**
 * Component type display configuration
 */
export interface TypeConfig {
  label: string
  color: string
}

export const TYPE_CONFIGS: Record<ComponentMetadata['type'], TypeConfig> = {
  trigger: {
    label: 'Trigger',
    color: 'text-gray-500',
  },
  input: {
    label: 'Input',
    color: 'text-blue-600',
  },
  scan: {
    label: 'Scan',
    color: 'text-purple-600',
  },
  process: {
    label: 'Process',
    color: 'text-green-600',
  },
  output: {
    label: 'Output',
    color: 'text-orange-600',
  },
}
