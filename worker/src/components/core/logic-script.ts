import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  ContainerError,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';

const variableConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    'string',
    'number',
    'boolean',
    'json',
    'secret',
    'list',
    'list-text',
    'list-number',
    'list-boolean',
    'list-json',
  ]).default('json'),
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
    // List types with subtypes
    case 'list':
    case 'list-text': return { id, label, dataType: port.list(port.text()), required: true };
    case 'list-number': return { id, label, dataType: port.list(port.number()), required: true };
    case 'list-boolean': return { id, label, dataType: port.list(port.boolean()), required: true };
    case 'list-json': return { id, label, dataType: port.list(port.json()), required: true };
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
// Output is written to the file at SHIPSEC_OUTPUT_PATH (mounted from host)
const harnessCode = `
import { readFileSync, writeFileSync } from "node:fs";

async function run() {
  try {
    console.log('[Script] Starting execution...');
    
    // Read the combined payload from the mounted input file
    const inputPath = process.env.SHIPSEC_INPUT_PATH || '/shipsec-output/input.json';
    const payload = JSON.parse(readFileSync(inputPath, 'utf8'));
    
    // 1. Write user script to file so it can be imported
    if (!payload.code) {
      throw new Error("No script code provided in payload");
    }
    writeFileSync("./user_script.ts", payload.code);

    // 2. Prepare inputs matching the variables definition
    const inputValues = {};
    if (Array.isArray(payload.variables)) {
      payload.variables.forEach(v => {
        if (v.name && payload[v.name] !== undefined) {
          inputValues[v.name] = payload[v.name];
        }
      });
    }

    // 3. Import and execute the user script
    // @ts-ignore
    const { script } = await import("./user_script.ts");
    const result = await script(inputValues);
    
    console.log('[Script] Execution completed, writing output...');
    const OUTPUT_PATH = process.env.SHIPSEC_OUTPUT_PATH || '/shipsec-output/result.json';
    
    // Write output to mounted file instead of stdout
    await Bun.write(OUTPUT_PATH, JSON.stringify(result || {}));

    console.log('[Script] Output written to', OUTPUT_PATH);
  } catch (err) {
    console.error('Runtime Error:', err.stack || err.message);
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
  stdinJson: false, // Inputs are passed via mounted file now
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

    // 1. Prepare Inputs from connected ports (keep for logging purposes)
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

    // 3. Build the shell command that sets up base harness files
    // The heavy payload (code and inputs) is passed via stdin
    const shellCommand = [
      `echo "${pluginB64}" | base64 -d > plugin.ts`,
      `echo "${harnessB64}" | base64 -d > harness.ts`,
      `bun run --preload ./plugin.ts harness.ts`,
    ].join(' && ');

    // 4. Configure the runner for this execution
    const runnerConfig: DockerRunnerConfig = {
      ...baseRunner,
      command: ['-c', shellCommand],
      env: {
        // No SHIPSEC_INPUTS here to avoid E2BIG
      },
    };

    console.log('[LogicScript] Starting execution (inputs via mounted file)');
    context.emitProgress({
      message: 'Starting script execution in Docker...',
      level: 'info',
      data: { inputCount: Object.keys(params).length },
    });

    // 5. Execute using the Docker runner
    // We pass enriched params containing the processed code to runComponentWithRunner
    // They will be written to the mounted input.json file in the container
    const runnerParams = {
      ...params,
      code: processedUserCode,
    };

    const result = await runComponentWithRunner<typeof runnerParams, Record<string, unknown>>(
      runnerConfig,
      async () => {
        throw new ContainerError('Docker runner should handle this execution', {
          details: { reason: 'fallback_triggered' },
        });
      },
      runnerParams,
      context,
    );



    // 7. Map results to declared outputs
    const finalOutput: Record<string, unknown> = {};
    returns.forEach((r) => {
      if (result && r.name && result[r.name] !== undefined) {
        finalOutput[r.name] = result[r.name];
      } else {
        finalOutput[r.name] = null;
      }
    });

    console.log('[LogicScript] Execution completed with outputs:', finalOutput);
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
