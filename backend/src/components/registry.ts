import { ComponentDefinition } from './types';

export class ComponentRegistry {
  private readonly components = new Map<string, ComponentDefinition<any, any>>();

  register<I, O>(definition: ComponentDefinition<I, O>): void {
    if (this.components.has(definition.id)) {
      throw new Error(`Component ${definition.id} already registered`);
    }
    this.components.set(definition.id, definition);
  }

  get<I, O>(id: string): ComponentDefinition<I, O> | undefined {
    return this.components.get(id);
  }

  list(): ComponentDefinition<any, any>[] {
    return Array.from(this.components.values());
  }
}

export const componentRegistry = new ComponentRegistry();
