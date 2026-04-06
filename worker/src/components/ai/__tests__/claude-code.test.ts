import { describe, it, expect, vi, beforeEach, afterAll } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import * as SDK from '@shipsec/component-sdk';
import { createIsolatedVolume } from '../../../utils/isolated-volume';
import * as utils from '../utils';
import '../claude-code'; // Register the component

vi.mock('../../../utils/isolated-volume', () => {
  return {
    createIsolatedVolume: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue('mock-volume-name'),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getVolumeConfig: vi
        .fn()
        .mockReturnValue({ source: 'mock', target: '/workspace', readOnly: false }),
      getVolumeName: vi.fn().mockReturnValue('mock-volume-name'),
    })),
  };
});

describe('core.ai.claude-code', () => {
  let runSpy: any;
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...envSnapshot };
    delete process.env.LITELLM_BASE_URL;
    delete process.env.LITELLM_API_KEY;

    vi.spyOn(utils, 'getGatewaySessionToken').mockResolvedValue('mock-session-token');
    vi.spyOn(utils, 'getSkillWorkspaceFiles').mockResolvedValue({});

    runSpy = vi.spyOn(SDK, 'runComponentWithRunner').mockResolvedValue({
      stdout: '# Investigation Report\n\nFindings here.',
      stderr: '',
      exitCode: 0,
      results: [],
      raw: '',
    } as any);
  });

  afterAll(() => {
    process.env = envSnapshot;
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get('core.ai.claude-code');
    expect(component).toBeDefined();
    expect(component?.id).toBe('core.ai.claude-code');
  });

  it('should execute with valid inputs', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run',
      componentRef: 'test-ref',
      metadata: {
        connectedToolNodeIds: ['tool-1'],
        organizationId: 'org-1',
        hotplugMcpUrl: 'http://hotplug:10010/sessions/test-session/mcp',
        hotplugMcpToken: 'test-token',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Investigate the alerts',
      context: { alertId: '123' },
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', apiKey: 'sk-test' },
    };

    const params = {
      systemPrompt: '',
      autoApprove: true,
      providerConfig: {},
      skills: [],
      enablePlugins: [],
    };

    const result = await component.execute({ inputs, params }, context as any);

    expect(result.report).toContain('# Investigation Report');
    expect(createIsolatedVolume).toHaveBeenCalled();

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];

    expect(initCall['context.json']).toContain('"alertId": "123"');
    expect(initCall['mcp-config.json']).toContain('workflow-tools');
    expect(initCall['run.sh']).toContain('claude -p');
    expect(initCall['run.sh']).toContain('--dangerously-skip-permissions');

    expect(runSpy).toHaveBeenCalled();
    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.image).toBe('ghcr.io/shipsecai/claude-code:latest');
    expect(runnerCall.network).toBe('host');
    expect(runnerCall.env.ANTHROPIC_API_KEY).toBe('sk-test');
  });

  it('should include plugin setup in wrapper script when enablePlugins is set', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-plugins',
      componentRef: 'test-ref-plugins',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Review this code',
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', apiKey: 'sk-test' },
    };

    const params = {
      systemPrompt: '',
      autoApprove: true,
      providerConfig: {},
      skills: [],
      enablePlugins: ['superpowers', 'oh-my-claudecode'],
    };

    await component.execute({ inputs, params }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];
    const runScript = initCall['run.sh'] as string;

    // Should contain marketplace add commands
    expect(runScript).toContain('claude plugins marketplace add');
    expect(runScript).toContain('anthropics/claude-plugins-official');
    expect(runScript).toContain('Yeachan-Heo/oh-my-claudecode');

    // Should contain install and enable commands (qualified with marketplace URL)
    expect(runScript).toContain(
      'claude plugins install superpowers@https://github.com/anthropics/claude-plugins-official',
    );
    expect(runScript).toContain(
      'claude plugins enable superpowers@https://github.com/anthropics/claude-plugins-official',
    );
    expect(runScript).toContain(
      'claude plugins install oh-my-claudecode@https://github.com/Yeachan-Heo/oh-my-claudecode',
    );
    expect(runScript).toContain(
      'claude plugins enable oh-my-claudecode@https://github.com/Yeachan-Heo/oh-my-claudecode',
    );

    // Plugin setup should appear BEFORE the claude -p command
    const pluginIdx = runScript.indexOf('claude plugins marketplace add');
    const claudeIdx = runScript.indexOf('claude -p');
    expect(pluginIdx).toBeLessThan(claudeIdx);

    // Should log plugin activation
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Plugins will be installed'),
    );
  });

  it('should not include plugin setup when enablePlugins is empty', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-no-plugins',
      componentRef: 'test-ref-no-plugins',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Investigate issue',
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', apiKey: 'sk-test' },
    };

    const params = {
      systemPrompt: '',
      autoApprove: true,
      providerConfig: {},
      skills: [],
      enablePlugins: [],
    };

    await component.execute({ inputs, params }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];
    const runScript = initCall['run.sh'] as string;

    // Should NOT contain any plugin setup
    expect(runScript).not.toContain('claude plugins marketplace');
    expect(runScript).not.toContain('claude plugins install');
    expect(runScript).not.toContain('Plugin Installation');
  });

  it('should set model flag when modelId is provided', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-model',
      componentRef: 'test-ref-model',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Test model flag',
      model: { provider: 'anthropic', modelId: 'claude-opus-4-20250514', apiKey: 'sk-test' },
    };

    const params = {
      systemPrompt: '',
      autoApprove: true,
      providerConfig: {},
      skills: [],
      enablePlugins: [],
    };

    await component.execute({ inputs, params }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];
    const runScript = initCall['run.sh'] as string;

    expect(runScript).toContain('--model claude-opus-4-20250514');
  });

  it('should set ANTHROPIC_BASE_URL for zai-coding-plan provider', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-zai',
      componentRef: 'test-ref-zai',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Test ZAI provider',
      model: { provider: 'zai-coding-plan', apiKey: 'zai-key' },
    };

    const params = {
      systemPrompt: '',
      autoApprove: true,
      providerConfig: {},
      skills: [],
      enablePlugins: [],
    };

    await component.execute({ inputs, params }, context as any);

    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.env.ANTHROPIC_API_KEY).toBe('zai-key');
    expect(runnerCall.env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
  });

  it('should write supplementary files when provided', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-supp',
      componentRef: 'test-ref-supp',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Analyze data',
      supplementaryA: 'Scanner output here',
      supplementaryB: 'Log data here',
      model: { provider: 'anthropic', apiKey: 'sk-test' },
    };

    const params = {
      systemPrompt: '',
      autoApprove: true,
      providerConfig: {},
      skills: [],
      enablePlugins: [],
    };

    await component.execute({ inputs, params }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];

    expect(initCall['supplementary-a.txt']).toBe('Scanner output here');
    expect(initCall['supplementary-b.txt']).toBe('Log data here');
    expect(initCall['prompt.txt']).toContain('supplementary-a.txt');
    expect(initCall['prompt.txt']).toContain('supplementary-b.txt');
  });

  it('should pre-seed Claude config to skip onboarding prompts', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-config',
      componentRef: 'test-ref-config',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Test config pre-seeding',
      model: { provider: 'anthropic', apiKey: 'sk-test-key', modelId: 'claude-sonnet-4-20250514' },
    };

    const params = {
      systemPrompt: '',
      autoApprove: true,
      providerConfig: {},
      skills: [],
      enablePlugins: [],
    };

    await component.execute({ inputs, params }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];
    const runScript = initCall['run.sh'] as string;

    // Should contain onboarding bypass
    expect(runScript).toContain('hasCompletedOnboarding');
    // Should contain trust dialog acceptance for /workspace
    expect(runScript).toContain('hasTrustDialogAccepted');
    // Should contain API key approval with the actual key
    expect(runScript).toContain('sk-test-key');
    // Should contain settings.json with dangerous mode skip
    expect(runScript).toContain('skipDangerousModePermissionPrompt');
    // Config setup should appear BEFORE claude -p
    const configIdx = runScript.indexOf('hasCompletedOnboarding');
    const claudeIdx = runScript.indexOf('claude -p');
    expect(configIdx).toBeLessThan(claudeIdx);
  });
});
