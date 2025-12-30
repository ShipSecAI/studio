import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  ContainerError,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ValidationError,
} from '@shipsec/component-sdk';

const variableConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'json', 'secret', 'list']).default('json'),
});

const parameterSchema = z.object({
  code: z.string().default(`function script(input: Input): Output {
  // Your logic here
  return {};
}`),
  variables: z.array(variableConfigSchema).optional().default([]),
  returns: z.array(variableConfigSchema).optional().default([]),
});

const inputSchema = parameterSchema.passthrough();

type Input = z.infer<typeof inputSchema>;
type Output = Record<string, unknown>;

const mapTypeToPort = (type: string, id: string, label: string) => {
  switch (type) {
    case 'string': return { id, label, dataType: port.text(), required: true };
    case 'number': return { id, label, dataType: port.number(), required: true };
    case 'boolean': return { id, label, dataType: port.boolean(), required: true };
    case 'secret': return { id, label, dataType: port.secret(), required: true };
    case 'list': return { id, label, dataType: port.list(port.text()), required: true };
    default: return { id, label, dataType: port.json(), required: true };
  }
};

// Bun plugin for HTTP imports (allows import from URLs)
const pluginCode = `
import { plugin } from "bun";
const rx_any = /./;
const rx_http = /^https?:\\/\\//;
const rx_path = /^\\.*\\//;

async function load_http_module(href) {
    console.log("[http-loader] Fetching:", href);
    const response = await fetch(href);
    const text = await response.text();
    if (response.ok) {
        return {
            contents: text,
            loader: href.match(/\\.(ts|tsx)$/) ? "ts" : "js",
        };
    } else {
        throw new Error("Failed to load module '" + href + "': " + text);
    }
}

plugin({
    name: "http_imports",
    setup(build) {
        build.onResolve({ filter: rx_http }, (args) => {
            const url = new URL(args.path);
            return {
                path: url.href.replace(/^(https?):/, ''),
                namespace: url.protocol.replace(':', ''),
            };
        });
        build.onResolve({ filter: rx_path }, (args) => {
            if (rx_http.test(args.importer)) {
                const url = new URL(args.path, args.importer);
                return {
                    path: url.href.replace(/^(https?):/, ''),
                    namespace: url.protocol.replace(':', ''),
                };
            }
        });
        build.onLoad({ filter: rx_any, namespace: "http" }, (args) => load_http_module("http:" + args.path));
        build.onLoad({ filter: rx_any, namespace: "https" }, (args) => load_http_module("https:" + args.path));
    }
});
`;

// Harness code that runs the user script
const harnessCode = `
import { script } from "./user_script.ts";
const INPUTS = JSON.parse(process.env.SHIPSEC_INPUTS || '{}');

async function run() {
  try {
    const result = await script(INPUTS);
    console.log('---RESULT_START---');
    console.log(JSON.stringify(result));
    console.log('---RESULT_END---');
  } catch (err) {
    console.error('Runtime Error:', err.message);
    process.exit(1);
  }
}

run();
`;

// Base64 encode the static code
const pluginB64 = Buffer.from(pluginCode).toString('base64');
const harnessB64 = Buffer.from(harnessCode).toString('base64');

// Docker runner configuration - will be customized per execution
const baseRunner: DockerRunnerConfig = {
  kind: 'docker',
  image: 'oven/bun:alpine',
  entrypoint: 'sh',
  command: ['-c', ''], // Will be set dynamically in execute()
  env: {},
  network: 'bridge', // Need network access for fetch() and HTTP imports
  timeoutSeconds: 30,
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.logic.script',
  label: 'Script / Logic',
  category: 'transform',
  runner: baseRunner,
  inputSchema,
  outputSchema: z.record(z.string(), z.unknown()),
  docs: 'Execute custom TypeScript code in a secure Docker container. Supports fetch(), async/await, and modern JS.',
  metadata: {
    slug: 'logic-script',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Execute custom TypeScript in a secure Docker sandbox.',
    icon: 'Code',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
    inputs: [],
    outputs: [],
    parameters: [
      {
        id: 'variables',
        label: 'Input Variables',
        type: 'variable-list',
        default: [],
        description: 'Define input variables that will be available in your script.',
      },
      {
        id: 'returns',
        label: 'Output Variables',
        type: 'variable-list',
        default: [],
        description: 'Define output variables your script should return.',
      },
      {
        id: 'code',
        label: 'Script Code',
        type: 'textarea',
        rows: 15,
        default: 'export async function script(input: Input): Promise<Output> {\\n  // Your logic here\\n  return {};\\n}',
        description: 'Define a function named `script`. Supports async/await and fetch().',
        required: true,
      },
    ],
  },
  resolvePorts(params: any) {
    const inputs: any[] = [];
    const outputs: any[] = [];
    if (Array.isArray(params.variables)) {
      params.variables.forEach((v: any) => { if (v.name) inputs.push(mapTypeToPort(v.type || 'json', v.name, v.name)); });
    }
    if (Array.isArray(params.returns)) {
      params.returns.forEach((v: any) => { if (v.name) outputs.push(mapTypeToPort(v.type || 'json', v.name, v.name)); });
    }
    return { inputs, outputs };
  },
  async execute(params, context) {
    const { code, variables = [], returns = [] } = params;

    // 1. Prepare Inputs from connected ports
    const inputValues: Record<string, any> = {};
    variables.forEach((v) => {
      if (v.name && params[v.name] !== undefined) {
        inputValues[v.name] = params[v.name];
      }
    });

    // 2. Process user code - ensure it has 'export' keyword
    let processedUserCode = code;
    const exportRegex = /^(?!\s*export\s+)(.*?\s*(?:async\s+)?function\s+script\b)/m;
    if (exportRegex.test(processedUserCode)) {
      processedUserCode = processedUserCode.replace(exportRegex, (match) => `export ${match.trimStart()}`);
    }
    const userB64 = Buffer.from(processedUserCode).toString('base64');

    // 3. Build the shell command that sets up files and runs bun
    const shellCommand = [
      `echo "${pluginB64}" | base64 -d > plugin.ts`,
      `echo "${userB64}" | base64 -d > user_script.ts`,
      `echo "${harnessB64}" | base64 -d > harness.ts`,
      `bun run --preload ./plugin.ts harness.ts`,
    ].join(' && ');

    // 4. Configure the runner for this execution
    const runnerConfig: DockerRunnerConfig = {
      ...baseRunner,
      command: ['-c', shellCommand],
      env: {
        SHIPSEC_INPUTS: JSON.stringify(inputValues),
      },
    };

    context.emitProgress({
      message: 'Starting script execution in Docker...',
      level: 'info',
      data: { inputCount: Object.keys(inputValues).length },
    });

    // 5. Execute using the Docker runner
    const raw = await runComponentWithRunner<typeof params, any>(
      runnerConfig,
      async () => {
        // Fallback if docker runner fails - should not happen
        throw new ContainerError('Docker runner should handle this execution', {
          details: { reason: 'fallback_triggered' },
        });
      },
      params,
      context,
    );

    // 6. Parse the result from stdout
    let result: Record<string, unknown> = {};
    
    if (typeof raw === 'string') {
      const match = raw.match(/---RESULT_START---([\s\S]*)---RESULT_END---/);
      if (match) {
        try {
          result = JSON.parse(match[1].trim());
        } catch (err) {
          throw new ValidationError('Failed to parse script result JSON.', {
            cause: err as Error,
            details: { rawOutput: match[1].trim().slice(0, 200) },
          });
        }
      } else {
        // If no result markers, maybe the raw output is the result
        console.warn('No result markers found in output, returning empty result');
      }
    } else if (raw && typeof raw === 'object') {
      result = raw;
    }

    // 7. Map results to declared outputs
    const finalOutput: Record<string, unknown> = {};
    returns.forEach((r) => {
      if (result && r.name && result[r.name] !== undefined) {
        finalOutput[r.name] = result[r.name];
      } else {
        finalOutput[r.name] = null;
      }
    });

    context.emitProgress({
      message: 'Script execution completed',
      level: 'info',
      data: { outputCount: Object.keys(finalOutput).length },
    });

    return finalOutput;
  },
};

componentRegistry.register(definition);

export { definition };
