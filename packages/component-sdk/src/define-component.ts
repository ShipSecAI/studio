import type { ComponentDefinition } from './types';

export function defineComponent<I, O, P>(
  definition: ComponentDefinition<I, O, P>,
): ComponentDefinition<I, O, P> {
  return definition;
}
