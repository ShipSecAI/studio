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
    .default('ShipSec terminal demo')
    .describe('Message rendered alongside the animated progress bar.'),
  durationSeconds: z
    .number()
    .int()
    .min(5)
    .max(300)
    .default(20)
    .describe('How long the animation should run (seconds).'),
  barWidth: z
    .number()
    .int()
    .min(10)
    .max(80)
    .default(32)
    .describe('Width of the progress bar in characters.'),
  intervalMs: z
    .number()
    .int()
    .min(50)
    .max(1000)
    .default(120)
    .describe('Delay between frames in milliseconds.'),
  burstLines: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .describe('Number of log lines emitted per animation frame.'),
  lineLength: z
    .number()
    .int()
    .min(10)
    .max(200)
    .default(72)
    .describe('Approximate width (characters) of each emitted line.'),
});

const outputSchema = z.object({
  message: z.string(),
  durationSeconds: z.number(),
  framesAttempted: z.number(),
  rawOutput: z.string(),
});

export type TerminalDemoInput = z.infer<typeof inputSchema>;
export type TerminalDemoOutput = z.infer<typeof outputSchema>;

const pythonScript = String.raw`
import json
import math
import sys
import time

payload_text = sys.stdin.read() or "{}"
try:
    payload = json.loads(payload_text)
except json.JSONDecodeError:
    payload = {}

message = (payload.get("message") or "ShipSec terminal demo").strip() or "ShipSec terminal demo"

def clamp(value, minimum, maximum, default):
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = default
    return max(minimum, min(maximum, numeric))

duration = clamp(payload.get("durationSeconds"), 5, 300, 20)
bar_width = clamp(payload.get("barWidth"), 10, 80, 32)
interval_ms = clamp(payload.get("intervalMs"), 50, 1000, 120)
interval = interval_ms / 1000.0
burst_lines = clamp(payload.get("burstLines"), 1, 50, 5)
line_length = clamp(payload.get("lineLength"), 10, 200, 72)

spinner = "|/-\\"
start = time.time()
frames = 0

try:
    while True:
        elapsed = time.time() - start
        if elapsed >= duration:
            break
        phase = (elapsed % 5.0) / 5.0
        filled = int(math.floor(phase * bar_width))
        bar = "#" * filled + "." * (bar_width - filled)
        spin = spinner[frames % len(spinner)]
        line = f"\r{spin} {message} [{bar}] {phase * 100:05.1f}%"
        sys.stdout.write(line)
        for burst in range(burst_lines):
            prefix = f"\n[{frames:04d}:{burst:02d}] "
            payload_line = ''.join(
                chr(65 + ((frames + burst + idx) % 26))
                for idx in range(line_length)
            )
            sys.stdout.write(prefix + payload_line)
        sys.stdout.flush()
        time.sleep(interval)
        frames += 1
finally:
    sys.stdout.write("\\nTerminal demo complete.\\n")
    sys.stdout.flush()
`;

const runner: DockerRunnerConfig = {
  kind: 'docker',
  image: 'python:3.12-alpine',
  entrypoint: 'python3',
  command: ['-u', '-c', pythonScript],
  env: {
    PYTHONUNBUFFERED: '1',
  },
  network: 'bridge',
  timeoutSeconds: 600,
};

const definition: ComponentDefinition<TerminalDemoInput, TerminalDemoOutput> = {
  id: 'shipsec.security.terminal-demo',
  label: 'Terminal Stream Demo',
  category: 'security',
  runner,
  inputSchema,
  outputSchema,
  icon: 'Terminal',
  description: 'Emit animated PTY output to validate the live terminal streaming pipeline.',
  metadata: {
    slug: 'terminal-stream-demo',
    version: '1.0.0',
    type: 'utility',
    category: 'security',
    documentation:
      'Launches a lightweight Python animation inside Docker so engineers can confirm that PTY output is flowing into the ShipSec UI.',
    documentationUrl: 'https://parrot.live',
    icon: 'Terminal',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      'Use this component while building terminal-aware workflows—when executed, it prints a looping progress bar.',
    inputs: [
      {
        id: 'message',
        label: 'Message',
        dataType: port.text(),
        required: false,
        description: 'Text displayed next to the progress bar.',
      },
      {
        id: 'durationSeconds',
        label: 'Duration',
        dataType: port.number(),
        required: false,
        description: 'How long the animation should run.',
      },
      {
        id: 'burstLines',
        label: 'Burst lines',
        dataType: port.number(),
        required: false,
        description: 'How many lines to emit per frame when exercising the PTY stream.',
      },
      {
        id: 'lineLength',
        label: 'Line length',
        dataType: port.number(),
        required: false,
        description: 'Character width of each emitted line.',
      },
    ],
    outputs: [
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Captured terminal stream emitted by the Docker container.',
      },
    ],
    examples: ['Verify PTY streaming by running this component inside a workflow.'],
    parameters: [
      {
        id: 'durationSeconds',
        label: 'Duration (seconds)',
        type: 'number',
        min: 5,
        max: 300,
        default: 20,
      },
      {
        id: 'barWidth',
        label: 'Progress Bar Width',
        type: 'number',
        min: 10,
        max: 80,
        default: 32,
      },
      {
        id: 'intervalMs',
        label: 'Interval (ms)',
        type: 'number',
        min: 50,
        max: 1000,
        default: 120,
      },
      {
        id: 'burstLines',
        label: 'Burst Lines',
        type: 'number',
        min: 1,
        max: 50,
        default: 5,
      },
      {
        id: 'lineLength',
        label: 'Line Length',
        type: 'number',
        min: 10,
        max: 200,
        default: 72,
      },
    ],
  },
  async execute(input, context) {
    const params = inputSchema.parse(input)

    context.emitProgress({
      message: 'Launching terminal stream demo…',
      level: 'info',
      data: {
        durationSeconds: params.durationSeconds,
        barWidth: params.barWidth,
        intervalMs: params.intervalMs,
        burstLines: params.burstLines,
        lineLength: params.lineLength,
      },
    });

    const raw = await runComponentWithRunner<typeof params, string>(
      this.runner,
      async () => '' as string,
      params,
      context,
    );

    const result: TerminalDemoOutput = {
      message: params.message,
      durationSeconds: params.durationSeconds,
      framesAttempted:
        Math.floor((params.durationSeconds * 1000) / params.intervalMs) * params.burstLines,
      rawOutput: typeof raw === 'string' ? raw : JSON.stringify(raw),
    };

    return outputSchema.parse(result);
  },
};

componentRegistry.register(definition);
