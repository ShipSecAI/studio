import { createServer } from 'node:net';
import { runComponentWithRunner, ValidationError } from '@shipsec/component-sdk';

interface StartMcpServerInput {
  image: string;
  command?: string[];
  args?: string[];
  env?: Record<string, string>;
  port?: number;
  volumes?: {
    source: string;
    target: string;
    readOnly?: boolean;
  }[];
  params: Record<string, unknown>;
  context: any;
}

interface StartMcpServerOutput {
  endpoint: string;
  containerId?: string;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
        } else {
          resolve(port);
        }
      });
    });
  });
}

export async function startMcpDockerServer(
  input: StartMcpServerInput,
): Promise<StartMcpServerOutput> {
  const port = input.port ?? (await getAvailablePort());

  if (!input.image || input.image.trim().length === 0) {
    throw new ValidationError('Docker image is required for MCP server', {
      fieldErrors: { image: ['Docker image is required'] },
    });
  }

  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const runnerConfig = {
    kind: 'docker' as const,
    image: input.image,
    command: [...(input.command ?? []), ...(input.args ?? [])],
    env: { ...input.env, PORT: String(port), ENDPOINT: endpoint },
    network: 'bridge' as const,
    detached: true,
    ports: { [`127.0.0.1:${port}`]: port } as unknown as Record<number, number>,
    volumes: input.volumes,
  };

  const result = await runComponentWithRunner(
    runnerConfig,
    async () => ({}),
    input.params,
    input.context,
  );

  let containerId: string | undefined;
  if (result && typeof result === 'object' && 'containerId' in result) {
    containerId = (result as { containerId?: string }).containerId;
  }

  return {
    endpoint,
    containerId,
  };
}
