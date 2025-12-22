import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
} from '@shipsec/component-sdk';
import { spawn } from 'child_process';

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

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.logic.script',
  label: 'Script / Logic',
  category: 'transform',
  runner: { kind: 'inline' },
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
        type: 'json',
        default: [],
        description: 'Define input variables that will be available in your script.',
      },
      {
        id: 'returns',
        label: 'Output Variables',
        type: 'json',
        default: [],
        description: 'Define output variables your script should return.',
      },
      {
        id: 'code',
        label: 'Script Code',
        type: 'textarea',
        rows: 15,
        default: 'export async function script(input: Input): Promise<Output> {\n  // Your logic here\n  return {};\n}',
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
    
    // Bun runs TS natively!
    const userCode = code;

    // 1. Prepare Inputs
    const inputValues: Record<string, any> = {};
    variables.forEach((v) => {
      if (v.name && params[v.name] !== undefined) {
        inputValues[v.name] = params[v.name];
      }
    });

    // 2. Prepare the Plugin
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

    // 3. Harness to run the user script
    let processedUserCode = userCode;
    // Regex matches optional 'async', then 'function script', but only if NOT preceded by 'export '
    const exportRegex = /^(?!\s*export\s+)(.*?\s*(?:async\s+)?function\s+script\b)/m;
    if (exportRegex.test(processedUserCode)) {
      processedUserCode = processedUserCode.replace(exportRegex, (match) => `export ${match.trimStart()}`);
    }

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

    // 4. Encode to Base64
    const pluginB64 = Buffer.from(pluginCode).toString('base64');
    const userB64 = Buffer.from(processedUserCode).toString('base64');
    const harnessB64 = Buffer.from(harnessCode).toString('base64');

    // 5. Execute in Docker
    return new Promise((resolve, reject) => {
      context.logger.info('[Script] Starting container with HTTP Loader...');
      
      const dockerProcess = spawn('docker', [
        'run', '--rm', '-i',
        '--name', `shipsec-script-${context.runId}-${Date.now()}`,
        '--label', 'shipsec-managed=true',
        '--memory', '256m',
        '--cpus', '0.5',
        '-e', `SHIPSEC_INPUTS=${JSON.stringify(inputValues)}`,
        'oven/bun:alpine',
        'sh', '-c', 
        `echo "${pluginB64}" | base64 -d > plugin.ts && ` +
        `echo "${userB64}" | base64 -d > user_script.ts && ` +
        `echo "${harnessB64}" | base64 -d > harness.ts && ` +
        `bun run --preload ./plugin.ts harness.ts`
      ]);

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        dockerProcess.kill();
        reject(new Error('Script execution timed out (30s)'));
      }, 30000);

      dockerProcess.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        const logs = str.replace(/---RESULT_START---[\s\S]*---RESULT_END---/, '').trim();
        if (logs) context.logger.info('[Script Output]', { output: logs });
      });

      dockerProcess.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        context.logger.error('[Script Error]', { output: str.trim() });
      });

      dockerProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          return reject(new Error(`Script failed with exit code ${code}. ${stderr}`));
        }

        const match = stdout.match(/---RESULT_START---([\s\S]*)---RESULT_END---/);
        if (!match) {
          return reject(new Error('Script finished but no result was returned.'));
        }

        try {
          const result = JSON.parse(match[1].trim());
          const finalOutput: Record<string, unknown> = {};
          returns.forEach((r) => {
            if (result && r.name && result[r.name] !== undefined) {
              finalOutput[r.name] = result[r.name];
            } else {
              finalOutput[r.name] = null;
            }
          });
          resolve(finalOutput);
        } catch (err) {
          reject(new Error('Failed to parse script result.'));
        }
      });
    });
  },
};

componentRegistry.register(definition);

export { definition };
