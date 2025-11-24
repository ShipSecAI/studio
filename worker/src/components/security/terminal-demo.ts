import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default('Hello from ShipSec Terminal!')
    .describe('Message to display in the terminal.'),
  durationSeconds: z
    .number()
    .int()
    .min(5)
    .max(60)
    .default(20)
    .describe('Total duration of the demo in seconds.'),
});

const outputSchema = z.object({
  message: z.string(),
  stepsCompleted: z.number(),
  durationSeconds: z.number(),
  rawOutput: z.string(),
});

export type TerminalDemoInput = z.infer<typeof inputSchema>;
export type TerminalDemoOutput = z.infer<typeof outputSchema>;

// Simple Node.js script that shows a progress bar
// Note: We don't read from stdin to avoid JSON input appearing in terminal
const nodeScript = String.raw`// Close stdin immediately to prevent any input from appearing
process.stdin.setRawMode && process.stdin.setRawMode(false);
process.stdin.resume();
process.stdin.on('data', () => {}); // Consume any stdin data silently

const message = process.env.MESSAGE || 'Hello from ShipSec Terminal!';
const durationSeconds = parseInt(process.env.DURATION_SECONDS || '20', 10);

// ANSI colors
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';
const bright = '\x1b[1m';

console.log('');
console.log(bright + cyan + '╔════════════════════════════════════════╗' + reset);
console.log(bright + cyan + '║' + reset + '     ShipSec Terminal Demo     ' + bright + cyan + '║' + reset);
console.log(bright + cyan + '╚════════════════════════════════════════╝' + reset);
console.log('');
console.log('Message: ' + yellow + message + reset);
console.log('Duration: ' + durationSeconds + ' seconds');
console.log('');

const startTime = Date.now();
const endTime = startTime + (durationSeconds * 1000);
const barWidth = 40;
const updateInterval = 200; // Update every 200ms for smooth animation

const interval = setInterval(() => {
  const now = Date.now();
  const elapsed = now - startTime;
  const total = endTime - startTime;
  const progress = Math.min(elapsed / total, 1);
  
  if (progress >= 1) {
    clearInterval(interval);
    // Clear the progress line using actual carriage return
    const cr = String.fromCharCode(0x0D);
    process.stdout.write(cr + ' '.repeat(80) + cr);
    console.log('');
    console.log(green + '✓' + reset + ' Demo completed successfully!');
    console.log('');
    
    // Don't output JSON at all - the component will use the captured output
    // JSON output pollutes the PTY stream, so we avoid it entirely
    process.exit(0);
    return;
  }

  const filled = Math.floor(progress * barWidth);
  const empty = barWidth - filled;
  const bar = green + '█'.repeat(filled) + reset + '░'.repeat(empty);
  const percentage = Math.floor(progress * 100);
  const elapsedSeconds = (elapsed / 1000).toFixed(1);
  const spinner = '|/-\\'[Math.floor(Date.now() / 200) % 4];

  // Use actual carriage return character (0x0D) instead of escaped string
  const cr = String.fromCharCode(0x0D);
  process.stdout.write(cr + bright + '[' + elapsedSeconds.padStart(5) + 's] ' + 
    '[' + bar + '] ' + percentage.toString().padStart(3) + '% ' + spinner + reset);
}, updateInterval);`;

const runner: DockerRunnerConfig = {
  kind: 'docker',
  image: 'node:18-alpine',
  entrypoint: 'node',
  command: ['-e', nodeScript],
  env: {
    MESSAGE: '{{message}}',
    DURATION_SECONDS: '{{durationSeconds}}',
  },
  network: 'none',
  timeoutSeconds: 30,
};

const definition: ComponentDefinition<TerminalDemoInput, TerminalDemoOutput> = {
  id: 'shipsec.security.terminal-demo',
  label: 'Terminal Stream Demo',
  category: 'security',
  runner,
  inputSchema,
  outputSchema,
  metadata: {
    slug: 'terminal-stream-demo',
    version: '2.1.0',
    type: 'process',
    category: 'security',
    documentation:
      'A simple terminal demo that displays a progress bar with ANSI colors. Perfect for testing PTY terminal streaming capabilities.',
    documentationUrl: 'https://asciinema.org/',
    icon: 'Terminal',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      'Displays a colorful progress bar that updates in real-time, demonstrating PTY terminal streaming with carriage returns and ANSI colors.',
    inputs: [
      {
        id: 'message',
        label: 'Message',
        dataType: port.text(),
        required: false,
        description: 'Message to display in the terminal demo.',
      },
      {
        id: 'durationSeconds',
        label: 'Duration (seconds)',
        dataType: port.number(),
        required: false,
        description: 'Total duration of the demo in seconds.',
      },
    ],
    outputs: [
      {
        id: 'message',
        label: 'Message',
        dataType: port.text(),
        description: 'The message that was displayed.',
      },
      {
        id: 'stepsCompleted',
        label: 'Steps Completed',
        dataType: port.number(),
        description: 'Number of progress updates that were completed.',
      },
      {
        id: 'durationSeconds',
        label: 'Duration (seconds)',
        dataType: port.number(),
        description: 'Total duration of the demo in seconds.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Captured terminal stream output.',
      },
    ],
    examples: ['Run this component to see a live progress bar in the terminal viewer.'],
    parameters: [
      {
        id: 'message',
        label: 'Message',
        type: 'text',
        default: 'Hello from ShipSec Terminal!',
      },
      {
        id: 'durationSeconds',
        label: 'Duration (seconds)',
        type: 'number',
        min: 5,
        max: 60,
        default: 20,
      },
    ],
  },
  async execute(input, context) {
    const params = inputSchema.parse(input);

    context.emitProgress({
      message: `Starting terminal demo for ${params.durationSeconds} seconds...`,
      level: 'info',
      data: {
        message: params.message,
        durationSeconds: params.durationSeconds,
      },
    });

    // Replace template variables in env vars
    const runnerWithEnv = {
      ...this.runner,
      env: {
        MESSAGE: params.message,
        DURATION_SECONDS: params.durationSeconds.toString(),
      },
    };

    const raw = await runComponentWithRunner<typeof params, any>(
      runnerWithEnv,
      async () => ({
        message: params.message,
        stepsCompleted: 0,
        rawOutput: 'No output',
      }),
      params,
      context,
    );

    // Parse the JSON output from stderr (script writes result to stderr to avoid PTY pollution)
    let parsedOutput: any = {
      message: params.message,
      stepsCompleted: Math.floor(params.durationSeconds * 5), // ~5 updates per second
      durationSeconds: params.durationSeconds,
      rawOutput: 'Demo completed',
    };

    if (typeof raw === 'string') {
      try {
        // Try to find JSON in the output (script writes to stderr, but it may be in stdout)
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedOutput = { ...parsedOutput, ...JSON.parse(jsonMatch[0]) };
        } else {
          parsedOutput.rawOutput = raw.trim();
        }
      } catch (e) {
        // If parsing fails, use the raw string as output (but filter out any JSON input that leaked)
        const cleaned = raw.replace(/\{"target".*?\}/g, '').replace(/\{"message".*?\}/g, '').trim();
        parsedOutput.rawOutput = cleaned || 'Demo completed';
      }
    } else if (raw && typeof raw === 'object') {
      parsedOutput = { ...parsedOutput, ...raw };
    }

    const result: TerminalDemoOutput = {
      message: parsedOutput.message || params.message,
      stepsCompleted: parsedOutput.stepsCompleted ?? Math.floor(params.durationSeconds * 5),
      durationSeconds: parsedOutput.durationSeconds ?? params.durationSeconds,
      rawOutput: parsedOutput.rawOutput || 'Demo completed',
    };

    context.emitProgress({
      message: `Demo completed: ${result.stepsCompleted} steps`,
      level: 'info',
      data: result,
    });

    return outputSchema.parse(result);
  },
};

componentRegistry.register(definition);
