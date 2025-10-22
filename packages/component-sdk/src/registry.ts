import type { ComponentDefinition } from './types';

class ComponentRegistry {
  private components = new Map<string, ComponentDefinition<any, any>>();

  register<I, O>(definition: ComponentDefinition<I, O>): void {
    if (this.components.has(definition.id)) {
      throw new Error(`Component ${definition.id} is already registered`);
    }
    this.components.set(definition.id, definition as ComponentDefinition<any, any>);
  }

  get<I, O>(id: string): ComponentDefinition<I, O> | undefined {
    return this.components.get(id) as ComponentDefinition<I, O> | undefined;
  }

  list(): Array<ComponentDefinition<any, any>> {
    return Array.from(this.components.values());
  }

  has(id: string): boolean {
    return this.components.has(id);
  }

  clear(): void {
    this.components.clear();
  }
}

export const componentRegistry = new ComponentRegistry();

