/**
 * Test component that uses Docker runner with a simple echo command
 * Used to verify Docker runner implementation
 */
import { z } from 'zod';
import type { ComponentDefinition } from '@shipsec/component-sdk';

type Input = { message: string };
type Output = string;

const inputSchema = z.object({
  message: z.string(),
});

const outputSchema = z.string();

const definition: ComponentDefinition<Input, Output> = {
  id: 'test.docker.echo',
  label: 'Docker Echo Test',
  category: 'transform',
  runner: {
    kind: 'docker',
    image: 'alpine:latest',
    command: ['sh', '-c', 'cat'],
    timeoutSeconds: 10,
  },
  inputSchema,
  outputSchema,
  docs: 'Test component that echoes input using Docker (alpine)',
  async execute(params, context) {
    // This should never be called when using Docker runner
    // The Docker runner intercepts and runs the container directly
    throw new Error('This component should run in Docker, not inline');
  },
};

export default definition;

