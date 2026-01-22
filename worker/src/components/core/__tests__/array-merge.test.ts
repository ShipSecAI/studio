import { describe, it, expect, beforeAll } from 'bun:test';
import { componentRegistry } from '../../index';
import type { ExecutionContext } from '@shipsec/component-sdk';

const mockContext: ExecutionContext = {
    runId: 'test-run',
    componentRef: 'array-merge-test',
    metadata: { runId: 'test-run', componentRef: 'array-merge-test' },
    logger: {
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
    },
    emitProgress: () => { },
};

describe('array-merge component', () => {
    beforeAll(async () => {
        await import('../../index');
    });

    it('should be registered', () => {
        const component = componentRegistry.get('core.array.merge');
        expect(component).toBeDefined();
        expect(component!.label).toBe('Array Merge');
        expect(component!.category).toBe('transform');
    });

    it('should use inline runner', () => {
        const component = componentRegistry.get('core.array.merge');
        expect(component!.runner.kind).toBe('inline');
    });

    it('should merge multiple arrays', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['a.example.com', 'b.example.com'],
                    arrayB: ['c.example.com', 'd.example.com'],
                },
                params: {
                    deduplicate: false,
                    sort: false,
                    trimWhitespace: false,
                    removeEmpty: false,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual([
            'a.example.com',
            'b.example.com',
            'c.example.com',
            'd.example.com',
        ]);
        expect(parsed.count).toBe(4);
    });

    it('should deduplicate entries when enabled', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['a.example.com', 'b.example.com'],
                    arrayB: ['b.example.com', 'c.example.com'],
                },
                params: {
                    deduplicate: true,
                    sort: false,
                    trimWhitespace: false,
                    removeEmpty: false,
                    caseSensitive: false,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual(['a.example.com', 'b.example.com', 'c.example.com']);
        expect(parsed.count).toBe(3);
    });

    it('should deduplicate case-insensitively by default', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['A.example.com', 'B.example.com'],
                    arrayB: ['a.example.com', 'c.example.com'],
                },
                params: {
                    deduplicate: true,
                    caseSensitive: false,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        // Should keep first occurrence's case
        expect(parsed.merged).toEqual(['A.example.com', 'B.example.com', 'c.example.com']);
        expect(parsed.count).toBe(3);
    });

    it('should deduplicate case-sensitively when enabled', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['A.example.com', 'a.example.com'],
                },
                params: {
                    deduplicate: true,
                    caseSensitive: true,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual(['A.example.com', 'a.example.com']);
        expect(parsed.count).toBe(2);
    });

    it('should sort entries when enabled', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['c.example.com', 'a.example.com'],
                    arrayB: ['b.example.com'],
                },
                params: {
                    deduplicate: false,
                    sort: true,
                    trimWhitespace: false,
                    removeEmpty: false,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual(['a.example.com', 'b.example.com', 'c.example.com']);
    });

    it('should trim whitespace when enabled', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['  a.example.com  ', 'b.example.com '],
                },
                params: {
                    deduplicate: false,
                    sort: false,
                    trimWhitespace: true,
                    removeEmpty: false,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual(['a.example.com', 'b.example.com']);
    });

    it('should remove empty strings when enabled', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['a.example.com', '', 'b.example.com'],
                    arrayB: ['', 'c.example.com'],
                },
                params: {
                    deduplicate: false,
                    sort: false,
                    trimWhitespace: false,
                    removeEmpty: true,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual(['a.example.com', 'b.example.com', 'c.example.com']);
        expect(parsed.count).toBe(3);
    });

    it('should handle empty inputs gracefully', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {},
                params: {
                    deduplicate: true,
                    sort: true,
                    trimWhitespace: true,
                    removeEmpty: true,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual([]);
        expect(parsed.count).toBe(0);
    });

    it('should merge all five arrays', async () => {
        const component = componentRegistry.get('core.array.merge');
        if (!component) throw new Error('Component not registered');

        const result = await component.execute(
            {
                inputs: {
                    arrayA: ['a'],
                    arrayB: ['b'],
                    arrayC: ['c'],
                    arrayD: ['d'],
                    arrayE: ['e'],
                },
                params: {
                    deduplicate: false,
                    sort: false,
                    trimWhitespace: false,
                    removeEmpty: false,
                },
            },
            mockContext,
        );

        const parsed = component.outputs.parse(result);
        expect(parsed.merged).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(parsed.count).toBe(5);
    });
});
