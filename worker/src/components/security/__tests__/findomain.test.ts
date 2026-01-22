import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('findomain component', () => {
    beforeAll(async () => {
        await import('../../index');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should be registered', () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        expect(component).toBeDefined();
        expect(component!.label).toBe('Findomain');
        expect(component!.category).toBe('security');
    });

    it('should use docker runner with shell wrapper', () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        expect(component!.runner.kind).toBe('docker');
        if (component!.runner.kind === 'docker') {
            expect(component!.runner.entrypoint).toBe('sh');
            expect(component!.runner.command).toContain('-c');
            expect(component!.runner.command).toContain('findomain "$@"');
        }
    });

    it('should parse raw text output into subdomains', async () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'findomain-test',
        });

        vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
            'api.example.com\napp.example.com\nwww.example.com',
        );

        const result = await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.subdomains).toEqual(['api.example.com', 'app.example.com', 'www.example.com']);
        expect(parsed.count).toBe(3);
    });

    it('should deduplicate subdomains', async () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'findomain-test',
        });

        vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
            'api.example.com\napi.example.com\nwww.example.com',
        );

        const result = await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.subdomains).toEqual(['api.example.com', 'www.example.com']);
        expect(parsed.count).toBe(2);
    });

    it('should handle empty targets gracefully', async () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'findomain-test',
        });

        const result = await component.execute(
            {
                inputs: { targets: ['   ', ''] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.subdomains).toEqual([]);
        expect(parsed.count).toBe(0);
    });

    it('should pass resolved flag when enabled', async () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'findomain-test',
        });

        const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('sub.example.com');

        await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: { resolved: true },
            },
            context,
        );

        expect(runnerSpy).toHaveBeenCalled();
        const [runnerConfig] = runnerSpy.mock.calls[0];
        if (runnerConfig.kind === 'docker') {
            expect(runnerConfig.command).toContain('-r');
        }
    });

    it('should pass quiet flag when enabled', async () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'findomain-test',
        });

        const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

        await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: { quiet: true },
            },
            context,
        );

        expect(runnerSpy).toHaveBeenCalled();
        const [runnerConfig] = runnerSpy.mock.calls[0];
        if (runnerConfig.kind === 'docker') {
            expect(runnerConfig.command).toContain('-q');
        }
    });

    it('should handle stdout object response', async () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'findomain-test',
        });

        vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({
            stdout: 'api.example.com\nwww.example.com',
        });

        const result = await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.subdomains).toEqual(['api.example.com', 'www.example.com']);
    });

    it('should filter out info messages from output', async () => {
        const component = componentRegistry.get('shipsec.findomain.run');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'findomain-test',
        });

        vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
            '[INFO] Starting scan\napi.example.com\n>> Processing\nwww.example.com',
        );

        const result = await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.subdomains).toEqual(['api.example.com', 'www.example.com']);
    });
});
