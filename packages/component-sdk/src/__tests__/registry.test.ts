import { describe, it, expect, beforeEach } from 'bun:test';
import { z } from 'zod';
import { componentRegistry } from '../registry';
import type { ComponentDefinition } from '../types';

describe('ComponentRegistry', () => {
  // Clear registry before each test
  beforeEach(() => {
    componentRegistry.clear();
  });

  it('should register a component', () => {
    const component: ComponentDefinition = {
      id: 'test.component',
      label: 'Test Component',
      category: 'transform',
      runner: { kind: 'inline' },
      inputSchema: z.object({ input: z.string() }),
      outputSchema: z.object({ output: z.string() }),
      execute: async (params: any) => ({ output: params.input }),
    };

    componentRegistry.register(component);

    const retrieved = componentRegistry.get('test.component');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('test.component');
    expect(retrieved?.label).toBe('Test Component');
  });

  it('should throw error when registering duplicate component', () => {
    const component: ComponentDefinition = {
      id: 'duplicate.component',
      label: 'Duplicate',
      category: 'transform',
      runner: { kind: 'inline' },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    };

    componentRegistry.register(component);

    expect(() => componentRegistry.register(component)).toThrow(
      'Component duplicate.component is already registered',
    );
  });

  it('should return undefined for non-existent component', () => {
    const component = componentRegistry.get('non.existent');
    expect(component).toBeUndefined();
  });

  it('should list all registered components', () => {
    const component1: ComponentDefinition = {
      id: 'component.one',
      label: 'One',
      category: 'input',
      runner: { kind: 'inline' },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    };

    const component2: ComponentDefinition = {
      id: 'component.two',
      label: 'Two',
      category: 'output',
      runner: { kind: 'inline' },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    };

    componentRegistry.register(component1);
    componentRegistry.register(component2);

    const all = componentRegistry.list();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.id)).toContain('component.one');
    expect(all.map((c) => c.id)).toContain('component.two');
  });

  it('should check if component exists', () => {
    const component: ComponentDefinition = {
      id: 'exists.component',
      label: 'Exists',
      category: 'transform',
      runner: { kind: 'inline' },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    };

    expect(componentRegistry.has('exists.component')).toBe(false);

    componentRegistry.register(component);

    expect(componentRegistry.has('exists.component')).toBe(true);
  });

  it('should clear all components', () => {
    const component: ComponentDefinition = {
      id: 'clear.test',
      label: 'Clear Test',
      category: 'transform',
      runner: { kind: 'inline' },
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    };

    componentRegistry.register(component);
    expect(componentRegistry.list()).toHaveLength(1);

    componentRegistry.clear();
    expect(componentRegistry.list()).toHaveLength(0);
  });
});

