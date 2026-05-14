import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { LLMProviderSchema, llmProviderContractName } from '@shipsec/contracts';
import { createIsolatedVolume, resolveVolumeSource } from '../../utils/isolated-volume';
import { securityWikiContextSchema } from '../core/security-wiki-context';
import {
  requireOrganizationApiKey,
  shouldRouteViaGateway,
  getSkillWorkspaceFiles,
  getGatewayBaseUrl,
} from './utils';
import { getOpenCodePluginSetupScript } from './opencode-plugins';

const inputSchema = inputs({
  task: port(
    z.string().min(1, 'Task cannot be empty').describe('The investigation task to perform.'),
    {
      label: 'Task',
      description: 'The main objective for the OpenCode agent (e.g. "Investigate these alerts").',
    },
  ),
  context: port(
    z.unknown().optional().describe('Contextual data (JSON) to assist the investigation.'),
    {
      label: 'Context',
      description: 'Optional JSON data providing context (alerts, logs, previous findings).',
      connectionType: { kind: 'primitive', name: 'json' },
      allowAny: true,
      reason: 'Context is a dynamic JSON object.',
    },
  ),
  model: port(
    LLMProviderSchema()
      .default({
        provider: 'openai',
        modelId: 'gpt-4o',
      })
      .describe('Model configuration for the agent.'),
    {
      label: 'Model',
      description: 'LLM provider configuration.',
      connectionType: { kind: 'contract', name: llmProviderContractName, credential: true },
    },
  ),
  tools: port(z.unknown().optional().describe('Anchor for tool-mode nodes.'), {
    label: 'Connected Tools',
    description: 'Connect tool-mode nodes here to expose them to the agent.',
    allowAny: true,
    reason: 'Tool-mode port acts as a graph anchor; payloads are not consumed directly.',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
  }),
  workspaceVolumeName: port(
    z.string().optional().describe('Docker volume name containing a cloned repository.'),
    {
      label: 'Workspace Volume',
      description:
        'Optional clone-repo volume. When provided, the repository is mounted read-only at /workspace/repo-workspace/repo.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  supplementaryA: port(
    z
      .string()
      .optional()
      .describe('Additional data written to /workspace/supplementary-a.txt for the agent.'),
    {
      label: 'Supplementary Input A',
      description:
        'Optional text/data (e.g. scanner findings) written to a workspace file the agent can read.',
      allowAny: true,
      reason: 'Accepts any stringifiable data for the agent workspace.',
    },
  ),
  supplementaryB: port(
    z
      .string()
      .optional()
      .describe('Additional data written to /workspace/supplementary-b.txt for the agent.'),
    {
      label: 'Supplementary Input B',
      description:
        'Optional text/data (e.g. scanner findings) written to a workspace file the agent can read.',
      allowAny: true,
      reason: 'Accepts any stringifiable data for the agent workspace.',
    },
  ),
  wikiContext: port(securityWikiContextSchema.optional(), {
    label: 'Security Wiki Context',
    description:
      'Optional wiki mount/instruction context from the Security Wiki Context component.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const parameterSchema = parameters({
  systemPrompt: param(
    z.string().default('').describe('Optional investigator prompt template override.'),
    {
      label: 'System Prompt',
      editor: 'textarea',
      rows: 5,
      description: 'Override the default investigator prompt template.',
    },
  ),
  autoApprove: param(z.boolean().default(true).describe('Automatically approve agent actions.'), {
    label: 'Auto Approve',
    editor: 'boolean',
    description: 'If true, the agent runs without user intervention.',
  }),
  providerConfig: param(
    z
      .record(z.string(), z.unknown())
      .default({})
      .describe('Additional OpenCode provider configuration.'),
    {
      label: 'Provider Config',
      editor: 'json',
      description: 'Additional configuration merged into opencode.jsonc.',
    },
  ),
  skills: param(
    z.array(z.string()).default([]).describe('Agent skill names to inject into the workspace.'),
    {
      label: 'Skills',
      editor: 'tags',
      description:
        'Select agent skills to inject into the workspace as .agents/skills/*/SKILL.md files.',
    },
  ),
  enablePlugins: param(
    z
      .array(z.enum(['oh-my-opencode']))
      .default([])
      .describe('Install and activate OpenCode plugins for enhanced agent capabilities.'),
    {
      label: 'Enable Plugins',
      editor: 'multi-select',
      options: [{ label: 'oh-my-opencode', value: 'oh-my-opencode' }],
      description: 'Enable plugins for enhanced agent capabilities.',
    },
  ),
  hotplugCliHostPath: param(
    z
      .string()
      .optional()
      .default(process.env.HOTPLUG_CLI_HOST_PATH ?? '')
      .describe('Optional host path to a hotplug CLI binary to mount into the agent container.'),
    {
      label: 'Hotplug CLI Path',
      editor: 'text',
      description:
        'Mount this host binary at /usr/local/bin/hotplug so agents can compose MCP tools from shell scripts.',
    },
  ),
  opencodeAuthHostPath: param(
    z
      .string()
      .optional()
      .default(process.env.OPENCODE_AUTH_HOST_PATH ?? '')
      .describe('Optional host path to an OpenCode auth.json file to mount into the agent.'),
    {
      label: 'OpenCode Auth Path',
      editor: 'text',
      description:
        'Mount this host auth.json into the agent container so providers such as OpenCode Go can use local credentials.',
    },
  ),
  timeoutSeconds: param(
    z.number().int().min(60).max(7200).default(1200).describe('Agent container timeout.'),
    {
      label: 'Timeout Seconds',
      editor: 'number',
      description:
        'Maximum time the OpenCode container may run. Repo-wide reviews need more than the Docker runner default.',
    },
  ),
});

const outputSchema = outputs({
  report: port(z.string(), {
    label: 'Report',
    description: 'The final markdown report generated by the agent.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Full stdout/stderr logs from the agent execution.',
  }),
});

const definition = defineComponent({
  id: 'core.ai.opencode',
  label: 'OpenCode Agent',
  category: 'ai',
  runner: {
    kind: 'docker',
    image: process.env.OPENCODE_IMAGE?.trim() || 'ghcr.io/anomalyco/opencode:latest',
    entrypoint: 'opencode', // We will override this in execution
    network: 'host' as const, // Required to access localhost gateway
    command: ['help'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs the OpenCode agent to perform autonomous investigations using connected tools.',
  retryPolicy: {
    maxAttempts: 1, // Agents are expensive/impotent, normally don't retry automatically
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 10,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  ui: {
    slug: 'opencode-agent',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description: 'Autonomous coding and investigation agent.',
    icon: 'Bot',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ inputs, params }, context) {
    const {
      task,
      context: taskContext,
      model,
      supplementaryA,
      supplementaryB,
      workspaceVolumeName,
      wikiContext,
    } = inputs;
    const {
      systemPrompt,
      providerConfig,
      skills: selectedSkills,
      enablePlugins,
      hotplugCliHostPath,
      opencodeAuthHostPath,
      timeoutSeconds,
    } = params;

    const { organizationId } = context.metadata;

    // 1. Read Hotplug session URL and token injected by the workflow orchestration
    const hotplugMcpUrl = context.metadata.hotplugMcpUrl;
    const hotplugMcpToken = context.metadata.hotplugMcpToken;

    // Helper to map provider to OpenCode model string format
    const getOpenCodeModelString = (
      model: { provider: string; modelId: string } | undefined,
      routeViaGateway = false,
    ): string => {
      if (!model) return 'gpt-4o';
      if (routeViaGateway && model.provider === 'openai') {
        return `shipsec-gateway/${model.modelId}`;
      }
      // OpenCode expects models in format: provider/modelId
      // Most providers follow this pattern
      return `${model.provider}/${model.modelId}`;
    };

    const routeViaGateway = shouldRouteViaGateway() && model?.provider === 'openai';

    // When the AI gateway is enabled and no user-provided key, use the org key.
    let orgVirtualKey: string | undefined;
    if (routeViaGateway && !model?.apiKey && organizationId) {
      orgVirtualKey = await requireOrganizationApiKey(organizationId, {
        consumer: 'OpenCode agent',
      });
    } else if (routeViaGateway && !model?.apiKey) {
      orgVirtualKey = await requireOrganizationApiKey(organizationId ?? null, {
        consumer: 'OpenCode agent',
      });
    }

    const providerEnv = buildProviderEnv(model, orgVirtualKey, routeViaGateway);
    const gatewayBaseUrl = getGatewayBaseUrl();
    const gatewayApiKey = model?.apiKey || orgVirtualKey;

    // 2. Prepare opencode.json config
    // Note: We use 'host' networking, so we can reach localhost
    // Correct format from https://opencode.ai/docs/mcp-servers/
    // CRITICAL: oauth: false is required for custom headers (OAuth is auto-detected as default in v1.0.137+)
    // See: https://github.com/anomalyco/opencode/issues/5278
    const mcpConfig = { mcp: {} };

    // Build provider config for OpenCode
    // Z.AI requires the API key to be in provider.options.apiKey
    const providerConfigForOpenCode: Record<string, unknown> = {
      ...(model?.provider === 'zai-coding-plan' && model.apiKey
        ? {
            'zai-coding-plan': {
              options: {
                apiKey: model.apiKey,
              },
            },
          }
        : {}),
      ...(routeViaGateway && gatewayBaseUrl && model?.provider === 'openai' && model.modelId
        ? {
            'shipsec-gateway': {
              npm: '@ai-sdk/openai-compatible',
              name: 'ShipSec AI Gateway',
              options: {
                baseURL: gatewayBaseUrl,
                ...(gatewayApiKey ? { apiKey: gatewayApiKey } : {}),
              },
              models: {
                [model.modelId]: {},
              },
            },
          }
        : {}),
    };

    const opencodeConfig = {
      ...mcpConfig,
      provider: providerConfigForOpenCode,
      model: getOpenCodeModelString(model, routeViaGateway),
      permission: 'allow',
      // Merge in any additional provider config from parameters
      ...providerConfig,
    };

    // 3. Prepare Context and Prompt
    const contextJson = JSON.stringify(taskContext ?? {}, null, 2);

    // Default investigator prompt if none provided
    const defaultPrompt = `
# Investigation Task
{{TASK}}

# Context
The following context is available in /workspace/context.json.
Please investigate the issue and generate a detailed report.
`;

    // Build final prompt: use systemPrompt if provided, otherwise use default template
    // Always append the task to ensure it's included
    let finalPrompt: string;
    if (systemPrompt?.trim()) {
      finalPrompt = `${systemPrompt}\n\n# Task\n${task}`;
      if (taskContext && Object.keys(taskContext).length > 0) {
        finalPrompt +=
          '\n\n# Context\nThe following context is available in /workspace/context.json.';
      }
    } else {
      finalPrompt = defaultPrompt.replace('{{TASK}}', task);
    }

    // Append supplementary file references to the prompt
    const suppFiles: string[] = [];
    if (supplementaryA) suppFiles.push('/workspace/supplementary-a.txt');
    if (supplementaryB) suppFiles.push('/workspace/supplementary-b.txt');
    if (suppFiles.length > 0) {
      finalPrompt += `\n\n# Additional Data Files\n${suppFiles.map((f) => `- ${f}`).join('\n')}`;
    }
    if (workspaceVolumeName) {
      finalPrompt +=
        '\n\n# Repository Workspace\nA read-only checkout is mounted at /workspace/repo-workspace. Single-repo workflows use /workspace/repo-workspace/repo. Multi-repo workflows use /workspace/repo-workspace/repos/<owner__repo>. Inspect all mounted repositories before concluding.';
    }
    if (wikiContext?.enabled) {
      finalPrompt = `${wikiContext.instructions}\n\n${finalPrompt}`;
    }
    if (hotplugMcpUrl && hotplugMcpToken) {
      finalPrompt += [
        '',
        '# CLI Tool Access',
        'Use the Hotplug CLI for ShipSec tools. No native OpenCode MCP tools are configured for this run.',
        '- Check CLI: `shipsec-tools init`',
        '- List tools: `shipsec-tools list`',
        "- Call tools and get the raw MCP envelope: `shipsec-tools call <tool_name> '<json args>'`",
        "- Call tools and unwrap the text payload: `shipsec-tools call-text <tool_name> '<json args>'`",
        '- List findings as plain JSON text: `shipsec-tools findings 200 open`',
        '- List compact assessment candidates: `shipsec-tools candidates 200 open unassessed`',
        '- Read the local helper notes at `/workspace/tools/README.md`.',
        'The environment already contains `HOTPLUG_MCP_URL` and `HOTPLUG_MCP_TOKEN`.',
      ].join('\n');
    }

    // 4. Setup Isolated Volume
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = createIsolatedVolume(tenantId, context.runId);

    try {
      // 5. Execute Docker Container
      // Write a wrapper script to properly execute opencode with file reading
      // The script runs inside the container, so $(cat /workspace/prompt.txt) works correctly
      // Note: --quiet flag doesn't exist in opencode 1.1.34, use --log-level ERROR instead
      // Generate plugin setup lines if plugins are enabled
      const pluginSetupLines = getOpenCodePluginSetupScript(enablePlugins ?? []);
      const opencodeModel = getOpenCodeModelString(model, routeViaGateway);

      const wrapperScript = [
        '#!/bin/sh',
        'set -e',
        'mkdir -p /root/.local/share/opencode',
        'if [ -f /opencode-auth/auth.json ]; then cp /opencode-auth/auth.json /root/.local/share/opencode/auth.json; chmod 600 /root/.local/share/opencode/auth.json; fi',
        'cd /workspace',
        'chmod +x /workspace/tools/shipsec-tools /workspace/tools/hotplug 2>/dev/null || true',
        'export PATH="/workspace/tools:/usr/local/bin:$PATH"',
        'if command -v hotplug >/dev/null 2>&1 && ! hotplug --help >/dev/null 2>&1; then rm -f /workspace/tools/hotplug-disabled; touch /workspace/tools/hotplug-disabled; fi',
        ...pluginSetupLines,
        '# List MCP tools for debugging (stderr only)',
        'opencode mcp list --log-level ERROR >&2 || true',
        '# Run the agent. Some cheap models stop after tool calls, so request a final answer once after the inspection pass.',
        'opencode -m "$OPENCODE_MODEL" run --log-level ERROR "$(cat /workspace/prompt.txt)" > /workspace/opencode-output.txt',
        'if [ -z "${HOTPLUG_MCP_URL:-}" ]; then opencode -m "$OPENCODE_MODEL" run --continue --log-level ERROR "Return your final answer now. Do not call more tools. Use the exact output format requested in the original task." >> /workspace/opencode-output.txt; fi',
        'cat /workspace/opencode-output.txt',
        '',
      ].join('\n');

      const opencodeConfigJson = JSON.stringify(opencodeConfig, null, 2);
      // Initialize workspace with config, context, prompt, wrapper script, and supplementary files
      const workspaceFiles: Record<string, string> = {
        'context.json': contextJson,
        // Opencode prefers opencode.jsonc in cwd; keep opencode.json for backwards compat.
        'opencode.jsonc': opencodeConfigJson,
        'opencode.json': opencodeConfigJson,
        'prompt.txt': finalPrompt,
        'run.sh': wrapperScript,
        'tools/README.md': buildHotplugToolReadme(Boolean(hotplugMcpUrl && hotplugMcpToken)),
        'tools/hotplug': buildHotplugCliShim(),
        'tools/shipsec-tools': buildShipsecToolsWrapper(),
      };
      if (supplementaryA) workspaceFiles['supplementary-a.txt'] = supplementaryA;
      if (supplementaryB) workspaceFiles['supplementary-b.txt'] = supplementaryB;

      // Inject selected agent skills into workspace
      const skillFiles = await getSkillWorkspaceFiles(organizationId ?? null, selectedSkills);
      Object.assign(workspaceFiles, skillFiles);

      // Log plugin activation (actual installation happens in wrapper script)
      if (enablePlugins && enablePlugins.length > 0) {
        context.logger.info(
          `[OpenCode] Plugins will be installed at startup: ${enablePlugins.join(', ')}`,
        );
      }

      await volume.initialize(workspaceFiles);

      const hotplugCliMount = resolveHotplugCliMount(hotplugCliHostPath);
      const opencodeAuthMount = resolveHostPathMount(opencodeAuthHostPath);
      if (hotplugMcpUrl && !hotplugCliMount) {
        context.logger.warn(
          '[OpenCode] Hotplug MCP session is attached, but no hotplug CLI binary was mounted. Set HOTPLUG_CLI_HOST_PATH or the Hotplug CLI Path parameter for CLI-native agent scripting.',
        );
      }

      const runnerConfig = {
        ...definition.runner,
        // Override entrypoint to /bin/sh to avoid the image's default 'opencode' entrypoint
        // The command will be executed as: /bin/sh /workspace/run.sh
        entrypoint: '/bin/sh',
        command: ['/workspace/run.sh'],
        // Use host network to access localhost gateway
        network: 'host' as const,
        env: {
          ...providerEnv,
          OPENCODE_MODEL: opencodeModel,
          ...(hotplugMcpUrl ? { HOTPLUG_MCP_URL: hotplugMcpUrl } : {}),
          ...(hotplugMcpToken ? { HOTPLUG_MCP_TOKEN: hotplugMcpToken } : {}),
          ...(wikiContext?.enabled ? wikiContext.env : {}),
        },
        volumes: [
          volume.getVolumeConfig('/workspace', false), // Read-write, mounted at /workspace
          ...(wikiContext?.enabled
            ? [
                {
                  source: wikiContext.wikiPath,
                  target: '/workspace/wiki',
                  readOnly: wikiContext.accessMode === 'read',
                },
                ...(wikiContext.repoPath
                  ? [{ source: wikiContext.repoPath, target: '/workspace/repo', readOnly: true }]
                  : []),
              ]
            : []),
          ...(hotplugCliMount
            ? [
                {
                  source: hotplugCliMount,
                  target: '/usr/local/bin/hotplug',
                  readOnly: true,
                },
              ]
            : []),
          ...(opencodeAuthMount
            ? [
                {
                  source: opencodeAuthMount,
                  target: '/opencode-auth/auth.json',
                  readOnly: true,
                },
              ]
            : []),
          ...(workspaceVolumeName
            ? [
                {
                  source: resolveVolumeSource(workspaceVolumeName),
                  target: '/workspace/repo-workspace',
                  readOnly: true,
                },
              ]
            : []),
        ],
        workingDir: '/workspace',
        timeoutSeconds,
        // Output managed by component, not /shipsec-output/result.json
        expectOutputFile: false,
      };

      // If we are using host network, we might need to handle port collisions or security?
      // For a worker, allow host network is a privileged operation.
      // Assumption: The worker environment allows this / is trusted.

      context.emitProgress({
        message: 'Running OpenCode agent...',
        level: 'info',
      });

      const runnerResult = await runComponentWithRunner(
        runnerConfig,
        async (raw) => raw, // Pass through raw result
        {},
        context,
      );

      // Parse output
      // The runner result handling in runComponentWithRunner usually involves parsing JSON
      // if the entrypoint returns JSON.
      // But here we are using a custom command that prints markdown to stdout.

      // We expect the result to be in the 'raw' or 'stdout' property of the result object
      // depending on how runComponentWithRunner captures it.
      // Based on httpx.ts it seems we get an object with { exitCode, stdout, stderr, raw } or similar
      // if using a standard docker runner adaptor.

      // Let's assume the raw output from the runner wrapper is what we get.
      // In httpx.ts:
      // const httpxRunnerOutputSchema = z.object({
      //   results: z.array(z.unknown()).optional().default([]),
      //   raw: z.string().optional().default(''),
      //   stderr: z.string().optional().default(''),
      //   exitCode: z.number().optional().default(0),
      // });

      // We should inspect what the runner returns.
      // Assuming a generic docker runner returns { stdout, stderr, exitCode }

      let stdout = '';
      let stderr = '';

      if (typeof runnerResult === 'string') {
        stdout = runnerResult;
      } else if (isRecord(runnerResult)) {
        stdout = (runnerResult.stdout as string) || (runnerResult.raw as string) || '';
        stderr = (runnerResult.stderr as string) || '';
      }

      return outputSchema.parse({
        report: cleanReport(stdout),
        rawOutput: `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
      });
    } finally {
      await volume.cleanup();
    }
  },
});

function resolveHotplugCliMount(hostPath: string | undefined): string | undefined {
  return resolveHostPathMount(hostPath);
}

function resolveHostPathMount(hostPath: string | undefined): string | undefined {
  const trimmed = hostPath?.trim();
  return trimmed || undefined;
}

function buildShipsecToolsWrapper(): string {
  return [
    '#!/bin/sh',
    'set -e',
    'unwrap_text() {',
    '  awk \'BEGIN{found=0} /"text"[[:space:]]*:/ { s=$0; sub(/^.*"text"[[:space:]]*:[[:space:]]*"/, "", s); sub(/",[[:space:]]*$/, "", s); print s; found=1 }\' | sed \'s/\\\\n/\\',
    '/g; s/\\\\"/"/g; s/\\\\\\\\/\\\\/g\'',
    '}',
    'case "${1:-}" in',
    '  list)',
    '    exec /workspace/tools/hotplug mcp tools list',
    '    ;;',
    '  call)',
    '    shift',
    '    exec /workspace/tools/hotplug mcp tools call "$@"',
    '    ;;',
    '  call-text)',
    '    shift',
    '    /workspace/tools/hotplug mcp tools call "$@" | unwrap_text',
    '    ;;',
    '  findings)',
    '    limit="${2:-200}"',
    '    status="${3:-open}"',
    '    assessment="${4:-}"',
    '    offset="${5:-0}"',
    '    if [ -n "$assessment" ]; then',
    '      args="{\\"limit\\":$limit,\\"status\\":\\"$status\\",\\"assessmentVerdict\\":\\"$assessment\\",\\"offset\\":$offset}"',
    '    else',
    '      args="{\\"limit\\":$limit,\\"status\\":\\"$status\\",\\"offset\\":$offset}"',
    '    fi',
    '    /workspace/tools/hotplug mcp tools call shipsec-studio__list_security_findings "$args" | unwrap_text',
    '    ;;',
    '  candidates)',
    '    limit="${2:-200}"',
    '    status="${3:-open}"',
    '    assessment="${4:-unassessed}"',
    '    offset="${5:-0}"',
    '    args="{\\"limit\\":$limit,\\"status\\":\\"$status\\",\\"assessmentVerdict\\":\\"$assessment\\",\\"offset\\":$offset}"',
    '    /workspace/tools/hotplug mcp tools call shipsec-studio__list_finding_assessment_candidates "$args" | unwrap_text',
    '    ;;',
    '  summary)',
    '    /workspace/tools/hotplug mcp tools call shipsec-studio__get_findings_summary "{}" | unwrap_text',
    '    ;;',
    '  init)',
    '    exec /workspace/tools/hotplug mcp init',
    '    ;;',
    '  *)',
    '    echo "usage: shipsec-tools list | call <tool> <json> | call-text <tool> <json> | findings [limit] [status] [assessmentVerdict] [offset] | candidates [limit] [status] [assessmentVerdict] [offset] | summary | init" >&2',
    '    exit 2',
    '    ;;',
    'esac',
    '',
  ].join('\n');
}

function buildHotplugCliShim(): string {
  return [
    '#!/bin/sh',
    'set -e',
    'if [ -x /usr/local/bin/hotplug ] && /usr/local/bin/hotplug --help >/dev/null 2>&1; then',
    '  exec /usr/local/bin/hotplug "$@"',
    'fi',
    'echo "Hotplug CLI is unavailable in this Linux agent container; no native OpenCode MCP tools are configured for this run." >&2',
    'exit 127',
    '',
  ].join('\n');
}

function buildHotplugToolReadme(hasHotplugSession: boolean): string {
  if (!hasHotplugSession) {
    return [
      '# ShipSec Tools',
      '',
      'No Hotplug MCP session was attached to this run. Continue with local code and files only.',
      '',
    ].join('\n');
  }
  return [
    '# ShipSec Tools',
    '',
    'This workspace exposes workflow tools through the Hotplug CLI. No native OpenCode MCP server is configured for these tools.',
    '',
    'CLI fallback is available only when `hotplug --help` succeeds. Useful commands:',
    '',
    '```sh',
    'shipsec-tools init',
    'shipsec-tools list',
    'shipsec-tools summary',
    'shipsec-tools findings 200 open',
    'shipsec-tools findings 200 open unassessed',
    'shipsec-tools candidates 200 open unassessed',
    'shipsec-tools candidates 200 open unassessed 200',
    'shipsec-tools call-text <tool_name> \'{"key":"value"}\'',
    'shipsec-tools call <tool_name> \'{"key":"value"}\'',
    'printf \'{"key":"value"}\' | shipsec-tools call <tool_name> -',
    '```',
    '',
    '`call-text`, `findings`, `candidates`, and `summary` unwrap the MCP envelope and print the tool text payload directly. Use `candidates` for first-pass finding assessment because it includes compact scanner/provider/resource/stack-relevance fields. Use `call` for writes such as `shipsec-studio__record_finding_assessment`, especially with JSON piped from a here-doc.',
    '',
    'For multi-tool reasoning, write a scratch script in `/workspace` that shells out to `shipsec-tools`, saves intermediate JSON, and emits the final structured finding/threat JSON requested by the task.',
    '',
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strip debug preamble and OpenCode internal log lines from stdout
 * so only the actual agent-generated report is returned.
 */
function cleanReport(raw: string): string {
  const lines = raw.split('\n');
  let startIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip [OpenCode] prefixed debug lines
    if (trimmed.startsWith('[OpenCode]')) {
      startIdx = i + 1;
      continue;
    }
    // Skip MCP server listing box-drawing characters
    if (
      /^[┌│└●◆◇]/.test(trimmed) ||
      trimmed.includes('MCP Servers') ||
      /^\d+ server\(s\)/.test(trimmed)
    ) {
      startIdx = i + 1;
      continue;
    }
    // Skip leading blank lines after debug output
    if (startIdx > 0 && trimmed === '') {
      startIdx = i + 1;
      continue;
    }
    break;
  }

  let result = lines.slice(startIdx).join('\n').trim();

  // Strip any LLM preamble before the first markdown heading (e.g. "## ...")
  const headingMatch = result.match(/^(.*?\n)*(#{1,3} )/s);
  if (headingMatch && headingMatch.index !== undefined && headingMatch.index > 0) {
    const beforeHeading = result.slice(0, headingMatch.index).trim();
    // Only strip if the preamble is short (< 500 chars) — avoids removing real content
    if (beforeHeading.length > 0 && beforeHeading.length < 500) {
      result = result.slice(result.indexOf(headingMatch[2], headingMatch.index));
    }
  }

  return result;
}

function buildProviderEnv(
  model?: { provider: string; apiKey?: string },
  orgVirtualKey?: string,
  routeViaGateway = false,
): Record<string, string> {
  const gatewayBaseUrl = getGatewayBaseUrl();
  if (routeViaGateway && gatewayBaseUrl) {
    const key = model?.apiKey || orgVirtualKey;
    return key
      ? {
          OPENAI_API_KEY: key,
          OPENAI_BASE_URL: gatewayBaseUrl,
        }
      : {};
  }

  if (!model?.apiKey) {
    return {};
  }

  switch (model.provider) {
    case 'openai':
      return { OPENAI_API_KEY: model.apiKey };
    case 'openrouter':
      return { OPENROUTER_API_KEY: model.apiKey };
    case 'anthropic':
      return { ANTHROPIC_API_KEY: model.apiKey };
    case 'groq':
      return { GROQ_API_KEY: model.apiKey };
    case 'xai':
      return { XAI_API_KEY: model.apiKey };
    case 'deepseek':
      return { DEEPSEEK_API_KEY: model.apiKey };
    default:
      return {};
  }
}

componentRegistry.register(definition);
