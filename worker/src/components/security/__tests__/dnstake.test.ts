import { describe, it, expect, beforeAll, afterEach, vi, mock } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

// Mock the IsolatedContainerVolume module
mock.module('../../../utils/isolated-volume', () => ({
    IsolatedContainerVolume: class MockIsolatedContainerVolume {
        initialize = vi.fn().mockResolvedValue('test-volume');
        getVolumeConfig = vi.fn().mockReturnValue({ source: 'test-volume', target: '/inputs' });
        cleanup = vi.fn().mockResolvedValue(undefined);
    },
}));

describe('dnstake component', () => {
    beforeAll(async () => {
        await import('../../index');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should be registered', () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        expect(component).toBeDefined();
        expect(component!.label).toBe('DNSTake');
        expect(component!.category).toBe('security');
    });

    it('should use docker runner with shell wrapper', () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        expect(component!.runner.kind).toBe('docker');
        if (component!.runner.kind === 'docker') {
            expect(component!.runner.entrypoint).toBe('sh');
            expect(component!.runner.command).toContain('-c');
            expect(component!.runner.command).toContain('dnstake "$@"');
        }
    });

    it('should handle empty targets gracefully', async () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'dnstake-test',
        });

        const result = await component.execute(
            {
                inputs: { targets: ['   ', ''] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.vulnerableDomains).toEqual([]);
        expect(parsed.targetCount).toBe(0);
        expect(parsed.vulnerableCount).toBe(0);
    });

    it('should parse vulnerable domains from output', async () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'dnstake-test',
        });

        vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
            'vulnerable.example.com [NS: ns1.dead.provider.com] [AWS Route 53]',
        );

        const result = await component.execute(
            {
                inputs: { targets: ['example.com', 'test.com'] },
                params: { concurrency: 25, silent: true },
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.vulnerableDomains.length).toBe(1);
        expect(parsed.vulnerableDomains[0].domain).toBe('vulnerable.example.com');
        expect(parsed.vulnerableDomains[0].vulnerable).toBe(true);
        expect(parsed.targetCount).toBe(2);
        expect(parsed.vulnerableCount).toBe(1);
    });

    it('should handle empty output (no vulnerabilities)', async () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'dnstake-test',
        });

        vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

        const result = await component.execute(
            {
                inputs: { targets: ['secure.example.com'] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.vulnerableDomains).toEqual([]);
        expect(parsed.vulnerableCount).toBe(0);
    });

    it('should pass concurrency parameter', async () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'dnstake-test',
        });

        const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

        await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: { concurrency: 50 },
            },
            context,
        );

        expect(runnerSpy).toHaveBeenCalled();
        const [runnerConfig] = runnerSpy.mock.calls[0];
        if (runnerConfig.kind === 'docker') {
            expect(runnerConfig.command).toContain('-c');
            expect(runnerConfig.command).toContain('50');
        }
    });

    it('should pass silent flag when enabled', async () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'dnstake-test',
        });

        const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

        await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: { silent: true },
            },
            context,
        );

        expect(runnerSpy).toHaveBeenCalled();
        const [runnerConfig] = runnerSpy.mock.calls[0];
        if (runnerConfig.kind === 'docker') {
            expect(runnerConfig.command).toContain('-s');
        }
    });

    it('should handle stdout object response', async () => {
        const component = componentRegistry.get('shipsec.dnstake.scan');
        if (!component) throw new Error('Component not registered');

        const context = sdk.createExecutionContext({
            runId: 'test-run',
            componentRef: 'dnstake-test',
        });

        vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({
            stdout: 'vuln.example.com',
        });

        const result = await component.execute(
            {
                inputs: { targets: ['example.com'] },
                params: {},
            },
            context,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.vulnerableDomains.length).toBe(1);
        expect(parsed.vulnerableDomains[0].domain).toBe('vuln.example.com');
    });
});
