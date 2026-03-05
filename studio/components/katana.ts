import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface KatanaOptions {
  url: string;
  depth?: number;
  outputFile?: string;
}

export class Katana {
  async run(options: KatanaOptions): Promise<string> {
    if (!options.url) {
      throw new Error('URL is required to run Katana scan.');
    }

    const depthArg = options.depth ? `-depth ${options.depth}` : '';
    const outputArg = options.outputFile ? `-o ${options.outputFile}` : '';

    const command = `katana ${depthArg} ${outputArg} ${options.url}`.trim();

    try {
      const { stdout, stderr } = await execAsync(command);
      if (stderr) {
        console.error('Katana error:', stderr);
      }
      return stdout;
    } catch (err) {
      console.error('Failed to run Katana:', err);
      throw err;
    }
  }
} 