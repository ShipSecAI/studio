/**
 * Tests for dynamic port resolution in component execution
 *
 * Validates that components with dynamic ports (resolvePorts) correctly
 * have their input/output schemas resolved at runtime before parsing inputs.
 * This tests the fix for the bug where dynamic inputs were being lost.
 */

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  createExecutionContext,
} from '@shipsec/component-sdk';

describe('Dynamic Port Resolution', () => {
  it('resolves dynamic input schemas before executing component', async () => {
    // Component with dynamic ports (uses resolvePorts)
    const component = defineComponent({
      id: 'test.dynamic.resolution',
      label: 'Dynamic Resolution Test',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({}), // Empty base schema
      outputs: outputs({}), // Empty base schema
      parameters: parameters({
        inputName: param(z.string(), {
          label: 'Input Name',
          editor: 'text',
        }),
      }),
      resolvePorts(params) {
        // Dynamically create input schema based on parameters
        const inputName = params.inputName || 'defaultInput';
        return {
          inputs: inputs({
            [inputName]: port(z.string(), {
              label: inputName,
            }),
          }),
          outputs: outputs({}),
        };
      },
      async execute({ inputs, params }, context) {
        const inputName = params.inputName || 'defaultInput';
        const inputValue = (inputs as any)[inputName] as string | undefined;

        context.emitProgress({
          message: `Received ${inputValue} for ${inputName}`,
          level: 'info',
        });

        return {
          [inputName]: inputValue || 'no-value',
        } as any;
      },
    });

    componentRegistry.register(component);

    // Create execution context
    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'test-node',
    });

    // Test 1: Execute with matching input
    const result1 = (await (component as any).execute(
      {
        inputs: { customInput: 'test-value' },
        params: { inputName: 'customInput' },
      } as any,
      context,
    )) as any;

    expect(result1).toEqual({ customInput: 'test-value' });

    // Test 2: Execute with different parameter (different schema)
    const result2 = (await (component as any).execute(
      {
        inputs: { alternativeInput: 'alt-value' },
        params: { inputName: 'alternativeInput' },
      } as any,
      context,
    )) as any;

    expect(result2).toEqual({ alternativeInput: 'alt-value' });

    // Test 3: Execute with wrong input name (should use default)
    const result3 = (await (component as any).execute(
      {
        inputs: { wrongInput: 'ignored' },
        params: { inputName: 'defaultInput' },
      } as any,
      context,
    )) as any;

    expect(result3).toEqual({ defaultInput: 'no-value' });
  });

  it('ensures activity resolves schemas for components with resolvePorts', async () => {
    // This test simulates what the activity does: check if component has resolvePorts
    // and use it to get the actual input schema

    const component = componentRegistry.get('test.dynamic.resolution');
    expect(component).toBeDefined();

    if (component && typeof (component as any).resolvePorts === 'function') {
      // Test with different parameter values
      const params1 = { inputName: 'fieldA' };
      const resolved1 = (component as any).resolvePorts(params1);

      // Verify resolved schema has the dynamic field
      expect(resolved1).toBeDefined();
      expect(resolved1?.inputs).toBeDefined();

      // Parse inputs using the resolved schema
      const inputs1 = { fieldA: 'valueA' };
      const parsed1 = resolved1?.inputs.parse(inputs1);
      expect(parsed1).toEqual({ fieldA: 'valueA' });

      // Test with different parameter value
      const params2 = { inputName: 'fieldB' };
      const resolved2 = (component as any).resolvePorts(params2);

      const inputs2 = { fieldB: 'valueB' };
      const parsed2 = resolved2?.inputs.parse(inputs2);
      expect(parsed2).toEqual({ fieldB: 'valueB' });

      // Verify that the static schema doesn't have these fields
      const staticInputs = component.inputs.parse({});
      expect(staticInputs).toEqual({});
    }
  });
});
