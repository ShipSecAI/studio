/**
 * Tests for optional input handling in component execution
 *
 * Validates that components with optional inputs (required: false or connectionType.kind === 'any')
 * can proceed when upstream components return undefined values, instead of failing with
 * a ValidationError.
 *
 * This tests the fix for workflows getting stuck in infinite retry loops when an upstream
 * component fails gracefully and returns undefined for some outputs.
 */

import { describe, expect, it, beforeAll } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  port,
  createExecutionContext,
  extractPorts,
  type ComponentPortMetadata,
} from '@shipsec/component-sdk';

describe('Optional Input Handling', () => {
  beforeAll(() => {
    // Register test component with optional input (required: false)
    if (!componentRegistry.has('test.optional.required-false')) {
      const component = defineComponent({
        id: 'test.optional.required-false',
        label: 'Optional Input (required: false)',
        category: 'transform',
        runner: { kind: 'inline' },
        inputs: inputs({
          requiredInput: port(z.string(), {
            label: 'Required Input',
            description: 'This input is required',
          }),
          optionalInput: port(z.string().optional(), {
            label: 'Optional Input',
            description: 'This input is optional',
          }),
        }),
        outputs: outputs({
          result: port(z.string(), { label: 'Result' }),
        }),
        async execute({ inputs }) {
          return {
            result: `required: ${inputs.requiredInput}, optional: ${inputs.optionalInput ?? 'undefined'}`,
          };
        },
      });
      componentRegistry.register(component);
    }

    // Register test component with allowAny input (connectionType.kind === 'any')
    if (!componentRegistry.has('test.optional.allow-any')) {
      const component = defineComponent({
        id: 'test.optional.allow-any',
        label: 'Optional Input (allowAny)',
        category: 'transform',
        runner: { kind: 'inline' },
        inputs: inputs({
          requiredInput: port(z.string(), {
            label: 'Required Input',
            description: 'This input is required',
          }),
          anyInput: port(z.any(), {
            label: 'Any Input',
            description: 'This input accepts any type including undefined',
            allowAny: true,
            reason: 'Accepts arbitrary data for testing',
            connectionType: { kind: 'any' },
          }),
        }),
        outputs: outputs({
          result: port(z.string(), { label: 'Result' }),
        }),
        async execute({ inputs }) {
          return {
            result: `required: ${inputs.requiredInput}, any: ${inputs.anyInput ?? 'undefined'}`,
          };
        },
      });
      componentRegistry.register(component);
    }

    // Register test component with all required inputs
    if (!componentRegistry.has('test.all-required')) {
      const component = defineComponent({
        id: 'test.all-required',
        label: 'All Required Inputs',
        category: 'transform',
        runner: { kind: 'inline' },
        inputs: inputs({
          input1: port(z.string(), {
            label: 'Input 1',
            description: 'Required input 1',
          }),
          input2: port(z.string(), {
            label: 'Input 2',
            description: 'Required input 2',
          }),
        }),
        outputs: outputs({
          result: port(z.string(), { label: 'Result' }),
        }),
        async execute({ inputs }) {
          return { result: `${inputs.input1} + ${inputs.input2}` };
        },
      });
      componentRegistry.register(component);
    }
  });

  describe('extractPorts identifies optional inputs correctly', () => {
    it('identifies required: false as optional', () => {
      const component = componentRegistry.get('test.optional.required-false');
      expect(component).toBeDefined();

      const ports = extractPorts(component!.inputs);
      const optionalPort = ports.find((p: ComponentPortMetadata) => p.id === 'optionalInput');

      expect(optionalPort).toBeDefined();
      expect(optionalPort!.required).toBe(false);
    });

    it('identifies connectionType.kind === "any" as optional', () => {
      const component = componentRegistry.get('test.optional.allow-any');
      expect(component).toBeDefined();

      const ports = extractPorts(component!.inputs);
      const anyPort = ports.find((p: ComponentPortMetadata) => p.id === 'anyInput');

      expect(anyPort).toBeDefined();
      expect(anyPort!.connectionType?.kind).toBe('any');
    });

    it('identifies regular inputs as required', () => {
      const component = componentRegistry.get('test.all-required');
      expect(component).toBeDefined();

      const ports = extractPorts(component!.inputs);

      for (const port of ports) {
        // Required is either undefined (defaults to true) or explicitly true
        expect(port.required).not.toBe(false);
        expect(port.connectionType?.kind).not.toBe('any');
      }
    });
  });

  describe('filterRequiredMissingInputs logic', () => {
    /**
     * This test validates the core logic used in run-component.activity.ts
     * to filter out optional inputs from the missing inputs list.
     */
    it('filters out optional inputs from missing list', () => {
      const component = componentRegistry.get('test.optional.required-false');
      expect(component).toBeDefined();

      const inputPorts = extractPorts(component!.inputs);

      // Simulate warnings for both inputs being undefined
      const warningsToReport = [
        { target: 'requiredInput', sourceRef: 'upstream', sourceHandle: 'output' },
        { target: 'optionalInput', sourceRef: 'upstream', sourceHandle: 'output' },
      ];

      // Apply the filtering logic from run-component.activity.ts
      const requiredMissingInputs = warningsToReport.filter((warning) => {
        const portMeta = inputPorts.find((p: ComponentPortMetadata) => p.id === warning.target);
        if (!portMeta) return true;
        if (portMeta.required === false) return false;
        if (portMeta.connectionType?.kind === 'any') return false;
        return true;
      });

      // Only requiredInput should be in the filtered list
      expect(requiredMissingInputs).toHaveLength(1);
      expect(requiredMissingInputs[0].target).toBe('requiredInput');
    });

    it('filters out allowAny inputs from missing list', () => {
      const component = componentRegistry.get('test.optional.allow-any');
      expect(component).toBeDefined();

      const inputPorts = extractPorts(component!.inputs);

      // Simulate warnings for both inputs being undefined
      const warningsToReport = [
        { target: 'requiredInput', sourceRef: 'upstream', sourceHandle: 'output' },
        { target: 'anyInput', sourceRef: 'upstream', sourceHandle: 'output' },
      ];

      // Apply the filtering logic from run-component.activity.ts
      const requiredMissingInputs = warningsToReport.filter((warning) => {
        const portMeta = inputPorts.find((p: ComponentPortMetadata) => p.id === warning.target);
        if (!portMeta) return true;
        if (portMeta.required === false) return false;
        if (portMeta.connectionType?.kind === 'any') return false;
        return true;
      });

      // Only requiredInput should be in the filtered list
      expect(requiredMissingInputs).toHaveLength(1);
      expect(requiredMissingInputs[0].target).toBe('requiredInput');
    });

    it('keeps all required inputs in missing list', () => {
      const component = componentRegistry.get('test.all-required');
      expect(component).toBeDefined();

      const inputPorts = extractPorts(component!.inputs);

      // Simulate warnings for both inputs being undefined
      const warningsToReport = [
        { target: 'input1', sourceRef: 'upstream', sourceHandle: 'output' },
        { target: 'input2', sourceRef: 'upstream', sourceHandle: 'output' },
      ];

      // Apply the filtering logic from run-component.activity.ts
      const requiredMissingInputs = warningsToReport.filter((warning) => {
        const portMeta = inputPorts.find((p: ComponentPortMetadata) => p.id === warning.target);
        if (!portMeta) return true;
        if (portMeta.required === false) return false;
        if (portMeta.connectionType?.kind === 'any') return false;
        return true;
      });

      // Both inputs should be in the filtered list
      expect(requiredMissingInputs).toHaveLength(2);
    });
  });

  describe('component execution with optional inputs', () => {
    it('executes component with undefined optional input (required: false)', async () => {
      const component = componentRegistry.get('test.optional.required-false');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run',
        componentRef: 'test-node',
      });

      // Execute with only the required input
      const result = await component!.execute!(
        {
          inputs: { requiredInput: 'hello', optionalInput: undefined },
          params: {},
        },
        context,
      );

      expect(result).toEqual({ result: 'required: hello, optional: undefined' });
    });

    it('executes component with undefined allowAny input', async () => {
      const component = componentRegistry.get('test.optional.allow-any');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run',
        componentRef: 'test-node',
      });

      // Execute with only the required input
      const result = await component!.execute!(
        {
          inputs: { requiredInput: 'hello', anyInput: undefined },
          params: {},
        },
        context,
      );

      expect(result).toEqual({ result: 'required: hello, any: undefined' });
    });
  });
});
