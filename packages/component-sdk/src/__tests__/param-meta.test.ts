import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { getParamMeta } from '../param-meta';
import { param, parameters } from '../schema-builders';
import { extractParameters } from '../zod-parameters';
import { validateParameterSchema } from '../schema-validation';

describe('Parameter Metadata System', () => {
  it('stores metadata via param()', () => {
    const schema = param(z.string(), {
      label: 'Model',
      editor: 'select',
      options: [
        { label: 'Small', value: 'small' },
        { label: 'Large', value: 'large' },
      ],
    });

    const meta = getParamMeta(schema);
    expect(meta?.label).toBe('Model');
    expect(meta?.editor).toBe('select');
  });
});

describe('Parameter Extraction', () => {
  it('extracts metadata from parameters schema', () => {
    const schema = parameters({
      model: param(z.string().default('gpt-4'), {
        label: 'Model',
        editor: 'select',
        options: [
          { label: 'GPT-4', value: 'gpt-4' },
          { label: 'GPT-3.5', value: 'gpt-3.5' },
        ],
      }),
      maxRetries: param(z.number().optional(), {
        label: 'Max Retries',
        editor: 'number',
        min: 0,
        max: 5,
      }),
    });

    const parametersMeta = extractParameters(schema);

    expect(parametersMeta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model',
          label: 'Model',
          type: 'select',
          default: 'gpt-4',
          required: false,
        }),
        expect.objectContaining({
          id: 'maxRetries',
          label: 'Max Retries',
          type: 'number',
          required: false,
          min: 0,
          max: 5,
        }),
      ]),
    );
  });
});

describe('Parameter Schema Validation', () => {
  it('flags missing parameter metadata', () => {
    const schema = z.object({
      model: z.string(),
    });

    const result = validateParameterSchema(schema);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('model');
    expect(result.errors[0]).toContain('param() metadata');
  });
});
