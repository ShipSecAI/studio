import { describe, expect, it } from 'bun:test';

import {
  getCategoryHeaderBackgroundColor,
  getCategorySeparatorColor,
  getCategoryTextColorClass,
} from '../categoryColors';

describe('categoryColors', () => {
  it('supports newly added categories', () => {
    expect(getCategorySeparatorColor('core', false)).toBeTruthy();
    expect(getCategorySeparatorColor('cloud', true)).toBeTruthy();
    expect(getCategoryHeaderBackgroundColor('process', false)).toBeTruthy();
  });

  it('falls back to input category for unknown values', () => {
    expect(getCategorySeparatorColor('unknown-category', false)).toBe(
      getCategorySeparatorColor('input', false),
    );
    expect(getCategoryTextColorClass('unknown-category')).toBe(getCategoryTextColorClass('input'));
  });

  it('normalizes category values', () => {
    expect(getCategorySeparatorColor(' CLOUD ', true)).toBe(
      getCategorySeparatorColor('cloud', true),
    );
  });
});
