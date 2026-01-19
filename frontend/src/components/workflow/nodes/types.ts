import { ComponentMetadata } from '@/schemas/component';

/**
 * Component type display configuration
 */
export interface TypeConfig {
  label: string;
  color: string;
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
};
