import { describe, expect, it } from 'bun:test';
import {
  buildPatchMap,
  escapeBackticks,
  escapeMarkdown,
  isLineInDiffHunks,
  parseDiffHunks,
  safeTruncate,
  stripWorkspacePrefix,
} from '../diff-hunk-parser';

describe('diff-hunk-parser', () => {
  describe('parseDiffHunks', () => {
    it('parses single and multi hunk patches', () => {
      const patch = ['@@ -1,2 +10,4 @@', ' a', '+b', '@@ -20,1 +40,2 @@', ' c'].join('\n');
      expect(parseDiffHunks(patch)).toEqual([
        { newStart: 10, newCount: 4 },
        { newStart: 40, newCount: 2 },
      ]);
    });

    it('defaults count to 1 when omitted', () => {
      expect(parseDiffHunks('@@ -5 +8 @@\n+x')).toEqual([{ newStart: 8, newCount: 1 }]);
    });

    it('returns empty on empty patch', () => {
      expect(parseDiffHunks('')).toEqual([]);
    });
  });

  describe('isLineInDiffHunks', () => {
    const patch = ['@@ -1,1 +10,3 @@', ' a', '+b', '@@ -30,1 +40,2 @@', ' c'].join('\n');

    it('matches lines inside a hunk range', () => {
      expect(isLineInDiffHunks(10, patch)).toBe(true);
      expect(isLineInDiffHunks(12, patch)).toBe(true);
      expect(isLineInDiffHunks(40, patch)).toBe(true);
      expect(isLineInDiffHunks(41, patch)).toBe(true);
    });

    it('rejects lines outside hunk ranges', () => {
      expect(isLineInDiffHunks(9, patch)).toBe(false);
      expect(isLineInDiffHunks(13, patch)).toBe(false);
      expect(isLineInDiffHunks(39, patch)).toBe(false);
      expect(isLineInDiffHunks(42, patch)).toBe(false);
      expect(isLineInDiffHunks(1, '')).toBe(false);
    });
  });

  describe('buildPatchMap', () => {
    it('builds patch map and skips files without patch', () => {
      const patchMap = buildPatchMap([
        { filename: 'src/a.ts', patch: '@@ -1 +1 @@' },
        { filename: 'src/b.ts' },
      ]);
      expect(patchMap.size).toBe(1);
      expect(patchMap.get('src/a.ts')).toBe('@@ -1 +1 @@');
      expect(patchMap.get('src/b.ts')).toBeUndefined();
    });
  });

  describe('stripWorkspacePrefix', () => {
    it('strips known prefixes and leading slash', () => {
      expect(stripWorkspacePrefix('/workspace/repo/src/a.ts')).toBe('src/a.ts');
      expect(stripWorkspacePrefix('/scan/repo/src/b.ts')).toBe('src/b.ts');
      expect(stripWorkspacePrefix('/repo/src/c.ts')).toBe('src/c.ts');
      expect(stripWorkspacePrefix('/src/d.ts')).toBe('src/d.ts');
      expect(stripWorkspacePrefix('src/e.ts')).toBe('src/e.ts');
    });
  });

  describe('escaping helpers', () => {
    it('escapes markdown chars and inner backticks', () => {
      expect(escapeMarkdown('<a|b>')).toBe('&lt;a\\|b&gt;');
      expect(escapeBackticks('a`b`c')).toBe('a``b``c');
    });

    it('truncates safely and avoids dangling code fences', () => {
      const long = ['line 1', '```', 'line 2', 'line 3'].join('\n');
      const truncated = safeTruncate(long, 14);
      expect(truncated.endsWith('\n...')).toBe(true);
    });
  });
});
