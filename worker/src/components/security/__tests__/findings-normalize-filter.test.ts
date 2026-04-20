import { describe, expect, it } from 'bun:test';
import { stripWorkspacePrefix } from '../findings-normalize';

describe('stripWorkspacePrefix', () => {
  it('should strip /workspace/repo/ prefix', () => {
    expect(stripWorkspacePrefix('/workspace/repo/src/main.ts')).toBe('src/main.ts');
  });

  it('should strip /scan/repo/ prefix', () => {
    expect(stripWorkspacePrefix('/scan/repo/src/main.ts')).toBe('src/main.ts');
  });

  it('should strip /scan/ prefix', () => {
    expect(stripWorkspacePrefix('/scan/src/main.ts')).toBe('src/main.ts');
  });

  it('should strip /workspace/ prefix', () => {
    expect(stripWorkspacePrefix('/workspace/src/main.ts')).toBe('src/main.ts');
  });

  it('should strip /repo/ prefix', () => {
    expect(stripWorkspacePrefix('/repo/src/main.ts')).toBe('src/main.ts');
  });

  it('should strip leading slash when no known prefix matches', () => {
    expect(stripWorkspacePrefix('/src/main.ts')).toBe('src/main.ts');
  });

  it('should return relative paths unchanged', () => {
    expect(stripWorkspacePrefix('src/main.ts')).toBe('src/main.ts');
  });

  it('should handle empty string', () => {
    expect(stripWorkspacePrefix('')).toBe('');
  });

  it('should prefer longest matching prefix', () => {
    // /workspace/repo/ is checked before /workspace/ due to array order
    expect(stripWorkspacePrefix('/workspace/repo/file.ts')).toBe('file.ts');
  });

  it('should handle file at root level', () => {
    expect(stripWorkspacePrefix('/workspace/repo/package.json')).toBe('package.json');
  });

  it('should handle deeply nested paths', () => {
    expect(stripWorkspacePrefix('/workspace/repo/a/b/c/d/e.ts')).toBe('a/b/c/d/e.ts');
  });
});
