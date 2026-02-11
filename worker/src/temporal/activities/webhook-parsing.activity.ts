import {
  createExecutionContext,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';

export interface ExecuteWebhookParsingScriptActivityInput {
  parsingScript: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  timeoutSeconds?: number;
}

/**
 * Executes a user-supplied webhook parsing script inside a Bun Docker container.
 *
 * Important: This MUST run in the worker (never in the backend API), since it requires Docker access.
 */
export async function executeWebhookParsingScriptActivity(
  input: ExecuteWebhookParsingScriptActivityInput,
): Promise<Record<string, unknown>> {
  const timeoutSeconds = input.timeoutSeconds ?? 30;

  // Ensure script has an `export` on the `script` function.
  let processedScript = input.parsingScript;
  const exportRegex = /^(?!\s*export\s+)(.*?\s*(?:async\s+)?function\s+script\b)/m;
  if (exportRegex.test(processedScript)) {
    processedScript = processedScript.replace(
      exportRegex,
      (match) => `export ${match.trimStart()}`,
    );
  }

  // Bun plugin for HTTP imports (allows importing TS/JS modules from URLs).
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
  }
  throw new Error("Failed to load module '" + href + "': " + text);
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

  // Harness reads params from SHIPSEC_INPUT_PATH (mounted file) to avoid env/arg size limits.
  const harnessCode = `
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

async function run() {
  try {
    const inputPath = process.env.SHIPSEC_INPUT_PATH || "/shipsec-output/input.json";
    const payload = JSON.parse(readFileSync(inputPath, "utf8"));

    if (!payload.code) {
      throw new Error("No parsing script provided in payload");
    }

    // Write user script so it can be imported by Bun.
    writeFileSync("./user_script.ts", payload.code);

    // @ts-ignore
    const { script } = await import("./user_script.ts");

    const input = {
      payload: payload.payload || {},
      headers: payload.headers || {},
    };

    const result = await script(input);

    const OUTPUT_PATH = process.env.SHIPSEC_OUTPUT_PATH || "/shipsec-output/result.json";
    const OUTPUT_DIR = OUTPUT_PATH.substring(0, OUTPUT_PATH.lastIndexOf("/"));
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    writeFileSync(OUTPUT_PATH, JSON.stringify(result || {}));
  } catch (err) {
    const message = err && typeof err.message === "string" ? err.message : String(err);
    console.error("Runtime Error:", message);
    process.exit(1);
  }
}

run();
`;

  const pluginB64 = Buffer.from(pluginCode).toString('base64');
  const harnessB64 = Buffer.from(harnessCode).toString('base64');

  const shellCommand = [
    `echo "${pluginB64}" | base64 -d > plugin.ts`,
    `echo "${harnessB64}" | base64 -d > harness.ts`,
    `bun run --preload ./plugin.ts harness.ts`,
  ].join(' && ');

  const runnerConfig: DockerRunnerConfig = {
    kind: 'docker',
    image: 'oven/bun:alpine',
    entrypoint: 'sh',
    command: ['-c', shellCommand],
    env: {},
    network: 'bridge',
    timeoutSeconds,
    stdinJson: false,
  };

  const context = createExecutionContext({
    runId: `webhook-parse-${Date.now()}`,
    componentRef: 'webhook.parse',
    logCollector: (entry) => {
      const log =
        entry.level === 'error'
          ? console.error
          : entry.level === 'warn'
            ? console.warn
            : entry.level === 'debug'
              ? console.debug
              : console.log;
      log(`[Webhook Parse] ${entry.message}`);
    },
  });

  const params = {
    code: processedScript,
    payload: input.payload,
    headers: input.headers,
  };

  return runComponentWithRunner<typeof params, Record<string, unknown>>(
    runnerConfig,
    async () => {
      throw new Error('Docker runner should handle webhook parsing execution');
    },
    params,
    context,
  );
}
