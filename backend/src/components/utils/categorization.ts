import type { ComponentDefinition } from '@shipsec/component-sdk';
import {
  type ComponentCategory,
  getComponentCategoryDescriptor,
  normalizeComponentCategory,
} from '@shipsec/shared';

export interface ComponentCategoryConfig {
  label: string;
  color: string;
  description: string;
  emoji: string;
  icon: string;
}

export function categorizeComponent(component: ComponentDefinition): ComponentCategory {
  const fromMetadata = normalizeComponentCategory(component.ui?.category);
  if (fromMetadata) {
    return fromMetadata;
  }

  const fromDefinition = normalizeComponentCategory(component.category);
  if (fromDefinition) {
    return fromDefinition;
  }

  return 'input';
}

export function getCategoryConfig(category: ComponentCategory): ComponentCategoryConfig {
  const descriptor = getComponentCategoryDescriptor(category);
  return {
    label: descriptor.label,
    color: descriptor.color,
    description: descriptor.description,
    emoji: descriptor.emoji,
    icon: descriptor.icon,
  };
}
