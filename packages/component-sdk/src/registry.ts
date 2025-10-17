import type { ComponentDefinition } from './types';

class ComponentRegistry {
  private components = new Map<string, ComponentDefinition>();

  register<I, O>(definition: ComponentDefinition<I, O>): void {
    if (this.components.has(definition.id)) {
      throw new Error(`Component ${definition.id} is already registered`);
    }
    this.components.set(definition.id, definition as ComponentDefinition);
  }

  get(id: string): ComponentDefinition | undefined {
    return this.components.get(id);
  }

  list(): Array<ComponentDefinition> {
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


