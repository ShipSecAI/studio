import { z } from 'zod';

export function coerceNumberFromText(schema: z.ZodNumber = z.number()): z.ZodType<number> {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  }, schema);
}

export function coerceBooleanFromText(): z.ZodType<boolean> {
  return z.preprocess((value) => {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }
    return value;
  }, z.boolean());
}
