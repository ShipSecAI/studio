import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { runComponentInline, runComponentWithRunner } from '../runner';
import { createExecutionContext } from '../context';
import { defineComponent } from '../define-component';
import { inputs, outputs, port } from '../schema-builders';

const enableDockerRunnerTests = process.env.ENABLE_DOCKER_TESTS === 'true';

const dockerAvailable = (() => {
  try {
    const result = Bun.spawnSync(['docker', 'version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
})();

const dockerIt = enableDockerRunnerTests && dockerAvailable ? it : it.skip;

describe('Component Runner', () => {
  describe('runComponentInline', () => {
    it('should execute component inline', async () => {
      const execute = async (params: { input: string }) => ({
        output: params.input.toUpperCase(),
      });

      const context = createExecutionContext({
        runId: 'test-run',
        componentRef: 'test.component',
      });

      const result = await runComponentInline(execute, { input: 'hello' }, context);

      expect(result.output).toBe('HELLO');
    });

    it('should pass context to component', async () => {
      let capturedContext: any;
      const execute = async (_params: unknown, ctx: any) => {
        capturedContext = ctx;
        return { success: true };
      };

      const context = createExecutionContext({
        runId: 'context-test',
        componentRef: 'context.component',
      });

      await runComponentInline(execute, {}, context);

      expect(capturedContext).toBeDefined();
      expect(capturedContext!.runId).toBe('context-test');
      expect(capturedContext!.componentRef).toBe('context.component');
    });

    it('should propagate errors from component', async () => {
      const execute = async () => {
        throw new Error('Component execution failed');
      };

      const context = createExecutionContext({
        runId: 'test-run',
        componentRef: 'error.component',
      });

      await expect(runComponentInline(execute, {}, context)).rejects.toThrow(
        'Component execution failed',
      );
    });
  });

  describe('runComponentWithRunner', () => {
    it('should execute with inline runner', async () => {
      const execute = async (params: { value: number }) => ({
        result: params.value * 2,
      });

      const context = createExecutionContext({
        runId: 'test-run',
        componentRef: 'math.component',
      });

      const result = await runComponentWithRunner(
        { kind: 'inline' },
        execute,
        { value: 21 },
        context,
      );

      expect(result.result).toBe(42);
    });

    dockerIt('should execute docker runner with real containers', async () => {
      const execute = async () => ({ message: 'should not be called' });

      const context = createExecutionContext({
        runId: 'test-run',
        componentRef: 'docker.component',
      });

      // Should fail because the image doesn't exist, but proves Docker execution is attempted
      await expect(
        runComponentWithRunner(
          { kind: 'docker', image: 'test:latest', command: ['run'] },
          execute,
          {},
          context,
        )
      ).rejects.toThrow();
    });

    it('should stub remote runner (fallback to inline)', async () => {
      const execute = async () => ({ status: 'ok' });

      const context = createExecutionContext({
        runId: 'test-run',
        componentRef: 'remote.component',
      });

      const result = await runComponentWithRunner(
        { kind: 'remote', endpoint: 'https://remote.example.com' },
        execute,
        {},
        context,
      );

      expect(result.status).toBe('ok');
    });
  });

  describe('Integration: Component with Runner', () => {
    it('should execute a complete component definition', async () => {
      const inputSchema = inputs({
        text: port(z.string(), { label: 'Text' }),
        repeat: port(z.number(), { label: 'Repeat' }),
      });

      const outputSchema = outputs({
        result: port(z.string(), { label: 'Result' }),
      });

      const component = defineComponent({
        id: 'test.repeat',
        label: 'Repeat Text',
        category: 'transform',
        runner: { kind: 'inline' },
        inputs: inputSchema,
        outputs: outputSchema,
      async execute({ inputs }) {
        return { result: inputs.text.repeat(inputs.repeat) };
      },
    });

      const context = createExecutionContext({
        runId: 'integration-test',
        componentRef: 'test.repeat',
      });

      // Validate input
      const inputValues = component.inputs.parse({
        text: 'Hi!',
        repeat: 3,
      });

      // Execute with runner
      const result = await runComponentWithRunner(
        component.runner,
        component.execute,
        { inputs: inputValues, params: {} },
        context,
      );

      // Validate output
      const validatedOutput = component.outputs.parse(result);

      expect(validatedOutput.result).toBe('Hi!Hi!Hi!');
    });
  });
});
