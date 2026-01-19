/**
 * Test component that uses Docker runner with a simple echo command
 * Used to verify Docker runner implementation
 */
import { z } from 'zod';
import { ContainerError, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';

const inputSchema = inputs({
  message: port(z.string(), {
    label: 'Message',
    description: 'Message to echo via the Docker container.',
  }),
});

const outputSchema = outputs({
  message: port(z.string(), {
    label: 'Message',
    description: 'Echoed message from the container.',
  }),
});

const definition = defineComponent({
  id: 'test.docker.echo',
  label: 'Docker Echo Test',
  category: 'transform',
  runner: {
    kind: 'docker',
    image: 'alpine:3.20',
    command: ['sh', '-c', 'cat'],
    timeoutSeconds: 10,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Test component that echoes input using Docker (alpine)',
  async execute(_params, _context) {
    // This should never be called when using Docker runner
    // The Docker runner intercepts and runs the container directly
    throw new ContainerError('This component should run in Docker, not inline', {
      details: { reason: 'inline_fallback_not_supported' },
    });
  },
});

export default definition;
