import type { ComponentDefinition } from './types';

type AnyComponentDefinition = ComponentDefinition<any, any>;

class ComponentRegistry {
  private components = new Map<string, AnyComponentDefinition>();

  register<I, O>(definition: ComponentDefinition<I, O>): void {
    if (this.components.has(definition.id)) {
      throw new Error(`Component ${definition.id} is already registered`);
    }
    this.components.set(definition.id, definition as AnyComponentDefinition);
  }

  get<I, O>(id: string): ComponentDefinition<I, O> | undefined {
    const component = this.components.get(id);
    return component as ComponentDefinition<I, O> | undefined;
  }

  list(): Array<AnyComponentDefinition> {
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

