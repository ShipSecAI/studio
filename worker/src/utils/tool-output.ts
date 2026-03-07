import { ServiceError } from '@shipsec/component-sdk';
import { createIsolatedVolume, type IsolatedVolume } from './isolated-volume';

export const TOOL_OUTPUT_DIR = '/tool-output';

export async function createToolOutputVolume(
  tenantId: string,
  runId: string,
  suffix: string,
): Promise<IsolatedVolume> {
  const volume = createIsolatedVolume(tenantId, `${runId}-${suffix}`);
  await volume.initialize({});
  return volume;
}

export async function readToolOutputFile(
  volume: IsolatedVolume,
  filename: string,
  toolName: string,
): Promise<string> {
  const files = await volume.readFiles([filename]);
  const content = files[filename];

  if (typeof content !== 'string') {
    throw new ServiceError(`${toolName} did not produce the expected output file`, {
      details: { filename },
    });
  }

  return content;
}
