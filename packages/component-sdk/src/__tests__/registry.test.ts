import { describe, it, expect, beforeEach } from 'bun:test';
import { z } from 'zod';
import { ComponentRegistry } from '../registry';
import { defineComponent } from '../define-component';
import { inputs, outputs, param, parameters, port } from '../schema-builders';
import type { ComponentDefinition } from '../types';

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  it('should register a component', () => {
    const component = defineComponent({
      id: 'test.component',
      label: 'Test Component',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({ input: port(z.string(), { label: 'Input' }) }),
      outputs: outputs({ output: port(z.string(), { label: 'Output' }) }),
      execute: async ({ inputs: payload }) => ({ output: payload.input }),
    });

    registry.register(component);

    const retrieved = registry.get('test.component');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('test.component');
    expect(retrieved?.label).toBe('Test Component');
  });

  it('should throw error when registering duplicate component', () => {
    const component = defineComponent({
      id: 'duplicate.component',
      label: 'Duplicate',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({}),
      outputs: outputs({}),
      execute: async () => ({}),
    });

    registry.register(component);

    expect(() => registry.register(component)).toThrow(
      'Component duplicate.component is already registered',
    );
  });

  it('should return undefined for non-existent component', () => {
    const component = registry.get('non.existent');
    expect(component).toBeUndefined();
  });

  it('should list all registered components', () => {
    const component1 = defineComponent({
      id: 'component.one',
      label: 'One',
      category: 'input',
      runner: { kind: 'inline' },
      inputs: inputs({}),
      outputs: outputs({}),
      execute: async () => ({}),
    });

    const component2 = defineComponent({
      id: 'component.two',
      label: 'Two',
      category: 'output',
      runner: { kind: 'inline' },
      inputs: inputs({}),
      outputs: outputs({}),
      execute: async () => ({}),
    });

    registry.register(component1);
    registry.register(component2);

    const all = registry.list();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.id)).toContain('component.one');
    expect(all.map((c) => c.id)).toContain('component.two');
  });

  it('should check if component exists', () => {
    const component = defineComponent({
      id: 'exists.component',
      label: 'Exists',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({}),
      outputs: outputs({}),
      execute: async () => ({}),
    });

    expect(registry.has('exists.component')).toBe(false);

    registry.register(component);

    expect(registry.has('exists.component')).toBe(true);
  });

  it('should clear all components', () => {
    const component = defineComponent({
      id: 'clear.test',
      label: 'Clear Test',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({}),
      outputs: outputs({}),
      execute: async () => ({}),
    });

    registry.register(component);
    expect(registry.list()).toHaveLength(1);

    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it('should extract parameters from schema when provided', () => {
    const component = defineComponent({
      id: 'param.component',
      label: 'Param Component',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({ input: port(z.string(), { label: 'Input' }) }),
      outputs: outputs({ output: port(z.string(), { label: 'Output' }) }),
      parameters: parameters({
        mode: param(z.string().default('fast'), {
          label: 'Mode',
          editor: 'select',
          options: [
            { label: 'Fast', value: 'fast' },
            { label: 'Safe', value: 'safe' },
          ],
        }),
      }),
      execute: async ({ inputs: payload }) => ({ output: payload.input }),
    });

    registry.register(component);

    const metadata = registry.getMetadata('param.component');
    expect(metadata?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mode',
          default: 'fast',
          type: 'select',
        }),
      ]),
    );
  });

  it('should register unified component definitions', () => {
    const component = defineComponent({
      id: 'unified.component',
      label: 'Unified Component',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({
        input: port(z.string(), { label: 'Input' }),
      }),
      outputs: outputs({
        output: port(z.string(), { label: 'Output' }),
      }),
      parameters: parameters({
        mode: param(z.string().default('fast'), {
          label: 'Mode',
          editor: 'select',
          options: [
            { label: 'Fast', value: 'fast' },
            { label: 'Safe', value: 'safe' },
          ],
        }),
      }),
      async execute({ inputs, params }) {
        return { output: `${inputs.input}-${params.mode}` };
      },
    });

    registry.register(component);

    const retrieved = registry.get('unified.component');
    expect(retrieved).toBeDefined();
    expect(retrieved?.label).toBe('Unified Component');
  });
});
