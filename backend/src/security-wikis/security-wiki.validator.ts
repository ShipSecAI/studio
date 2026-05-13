import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface WikiValidationInput {
  wikiPath: string;
  changedFiles: string[];
  runId: string;
  agentName: string;
  allowedGlobs: string[];
}

export interface WikiValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const MAX_FILE_BYTES = 256 * 1024;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /sk-[A-Za-z0-9_-]{32,}/,
  /ghp_[A-Za-z0-9_]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(glob: string): RegExp {
  const escaped = normalize(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLE_STAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLE_STAR§/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function validateSecurityWikiRun(input: WikiValidationInput): WikiValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowed = input.allowedGlobs.map(globToRegExp);
  const manifestPath = `agent-state/manifests/${input.runId}.yaml`;

  if (!input.changedFiles.includes(manifestPath)) {
    errors.push(`Missing required manifest in changed files: ${manifestPath}`);
  }

  for (const file of input.changedFiles) {
    const rel = normalize(file);
    if (rel.includes('..') || rel.startsWith('/')) {
      errors.push(`Invalid changed file path: ${file}`);
      continue;
    }
    if (!allowed.some((pattern) => pattern.test(rel))) {
      errors.push(`Changed file is outside allowed paths: ${rel}`);
    }
    const abs = join(input.wikiPath, rel);
    if (!existsSync(abs)) {
      warnings.push(`Changed file was deleted or missing at validation time: ${rel}`);
      continue;
    }
    const stat = lstatSync(abs);
    if (!stat.isFile()) {
      errors.push(`Changed path is not a regular file: ${rel}`);
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      errors.push(`Changed file exceeds ${MAX_FILE_BYTES} bytes: ${rel}`);
      continue;
    }
    const content = readFileSync(abs);
    if (content.includes(0)) {
      errors.push(`Binary/null-containing file is not allowed: ${rel}`);
      continue;
    }
    const text = content.toString('utf8');
    if (rel === manifestPath) {
      if (!text.includes(`run_id: ${input.runId}`)) {
        errors.push(`Manifest does not contain matching run_id: ${input.runId}`);
      }
      if (!text.includes(`agent: ${input.agentName}`)) {
        errors.push(`Manifest does not contain matching agent: ${input.agentName}`);
      }
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        errors.push(`Possible secret matched ${pattern} in ${rel}`);
      }
    }
    if (/raw[_ -]?scanner[_ -]?dump/i.test(text)) {
      warnings.push(`File references raw scanner dump; ensure it is only a pointer: ${rel}`);
    }
  }

  const duplicate = input.changedFiles.find(
    (file, idx) => input.changedFiles.indexOf(file) !== idx,
  );
  if (duplicate) {
    errors.push(`Duplicate changed file listed: ${duplicate}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function relativeWikiPath(wikiPath: string, filePath: string): string {
  return normalize(relative(wikiPath, filePath));
}
