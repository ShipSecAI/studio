export interface DiffHunk {
  newStart: number;
  newCount: number;
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const WORKSPACE_PREFIXES = ['/workspace/repo/', '/scan/repo/', '/scan/', '/workspace/', '/repo/'];

export function parseDiffHunks(patch: string): DiffHunk[] {
  if (!patch) return [];

  const hunks: DiffHunk[] = [];
  for (const line of patch.split('\n')) {
    const match = HUNK_HEADER_RE.exec(line);
    if (!match) continue;

    hunks.push({
      newStart: Number(match[1]),
      newCount: match[2] == null ? 1 : Number(match[2]),
    });
  }

  return hunks;
}

export function isLineInDiffHunks(line: number, patch: string): boolean {
  if (!Number.isInteger(line) || line < 1) return false;

  const hunks = parseDiffHunks(patch);
  return hunks.some((hunk) => line >= hunk.newStart && line < hunk.newStart + hunk.newCount);
}

export function buildPatchMap(files: { filename: string; patch?: string }[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const file of files) {
    if (!file.patch) continue;
    map.set(file.filename, file.patch);
  }

  return map;
}

export function stripWorkspacePrefix(filePath: string): string {
  for (const prefix of WORKSPACE_PREFIXES) {
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length);
    }
  }

  return filePath.startsWith('/') ? filePath.slice(1) : filePath;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeBackticks(text: string): string {
  return text.replace(/`/g, '``');
}

export function safeTruncate(text: string, max: number): string {
  if (max < 1 || text.length <= max) return text;

  let truncated = text.slice(0, max);
  const fenceCount = (truncated.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    const lastFence = truncated.lastIndexOf('```');
    if (lastFence >= 0) {
      const newlineBeforeFence = truncated.lastIndexOf('\n', lastFence - 1);
      truncated = newlineBeforeFence > 0 ? truncated.slice(0, newlineBeforeFence) : '';
    } else {
      const lastNewline = truncated.lastIndexOf('\n');
      if (lastNewline > 0) {
        truncated = truncated.slice(0, lastNewline);
      }
    }
  }

  return `${truncated}\n...`;
}
