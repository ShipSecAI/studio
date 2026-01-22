import { z } from 'zod';
import {
    componentRegistry,
    defineComponent,
    inputs,
    outputs,
    parameters,
    port,
    param,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
    arrayA: port(z.array(z.string()).optional(), {
        label: 'Array A',
        description: 'First array to merge.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
    arrayB: port(z.array(z.string()).optional(), {
        label: 'Array B',
        description: 'Second array to merge.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
    arrayC: port(z.array(z.string()).optional(), {
        label: 'Array C',
        description: 'Third array to merge.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
    arrayD: port(z.array(z.string()).optional(), {
        label: 'Array D',
        description: 'Fourth array to merge.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
    arrayE: port(z.array(z.string()).optional(), {
        label: 'Array E',
        description: 'Fifth array to merge.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
});

const parameterSchema = parameters({
    deduplicate: param(z.boolean().default(true), {
        label: 'Remove Duplicates',
        editor: 'boolean',
        description: 'Remove duplicate entries from the merged result.',
    }),
    sort: param(z.boolean().default(false), {
        label: 'Sort Results',
        editor: 'boolean',
        description: 'Sort the merged array alphabetically.',
    }),
    trimWhitespace: param(z.boolean().default(true), {
        label: 'Trim Whitespace',
        editor: 'boolean',
        description: 'Trim whitespace from each entry.',
    }),
    removeEmpty: param(z.boolean().default(true), {
        label: 'Remove Empty',
        editor: 'boolean',
        description: 'Remove empty strings from the result.',
    }),
    caseSensitive: param(z.boolean().default(false), {
        label: 'Case Sensitive',
        editor: 'boolean',
        description: 'When disabled, treats "A.example.com" and "a.example.com" as duplicates (recommended for domains).',
    }),
});

const outputSchema = outputs({
    merged: port(z.array(z.string()), {
        label: 'Merged Array',
        description: 'Combined array from all inputs.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
    count: port(z.number().int(), {
        label: 'Count',
        description: 'Total number of items in merged array.',
    }),
});

const definition = defineComponent({
    id: 'core.array.merge',
    label: 'Array Merge',
    category: 'transform',
    runner: { kind: 'inline' },
    inputs: inputSchema,
    outputs: outputSchema,
    parameters: parameterSchema,
    docs: 'Merge multiple arrays into one, with options to deduplicate, sort, and clean the results. Useful for combining outputs from multiple subdomain discovery tools.',
    ui: {
        slug: 'array-merge',
        version: '1.0.0',
        type: 'process',
        category: 'transform',
        description: 'Merge multiple arrays into one with deduplication.',
        icon: 'Merge',
        author: {
            name: 'ShipSecAI',
            type: 'shipsecai',
        },
        isLatest: true,
        deprecated: false,
        example: 'Merge Subfinder + Findomain + Assetfinder results',
        examples: [
            'Combine subdomain lists from multiple tools',
            'Merge and deduplicate scan results',
            'Consolidate data from parallel workflows',
        ],
    },
    async execute({ inputs, params }, context) {
        const { deduplicate, sort, trimWhitespace, removeEmpty, caseSensitive } = params;

        // Collect all arrays
        const allItems: string[] = [];
        const arrayKeys = ['arrayA', 'arrayB', 'arrayC', 'arrayD', 'arrayE'] as const;

        for (const key of arrayKeys) {
            const arr = inputs[key];
            if (Array.isArray(arr)) {
                allItems.push(...arr);
            }
        }

        // Process items
        let result = allItems;

        if (trimWhitespace) {
            result = result.map((item) => item.trim());
        }

        if (removeEmpty) {
            result = result.filter((item) => item.length > 0);
        }

        if (deduplicate) {
            if (caseSensitive) {
                result = [...new Set(result)];
            } else {
                // Case-insensitive deduplication, preserving first occurrence's case
                const seen = new Set<string>();
                result = result.filter((item) => {
                    const lower = item.toLowerCase();
                    if (seen.has(lower)) return false;
                    seen.add(lower);
                    return true;
                });
            }
        }

        if (sort) {
            result = result.sort((a, b) => a.localeCompare(b));
        }

        context.logger.info(
            `[ArrayMerge] Merged ${allItems.length} items into ${result.length} unique entries.`
        );

        return {
            merged: result,
            count: result.length,
        };
    },
});

componentRegistry.register(definition);

export default definition;
