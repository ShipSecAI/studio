import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { dirname } from 'node:path';

const ENV_PATH = `${process.cwd()}/.env.eng-104`;
const TEMPLATE_PATH = `${process.cwd()}/e2e-tests/.env.eng-104.example`;

type Field = {
  key: string;
  prompt: string;
  optional?: boolean;
  defaultValue?: string;
  hint?: string;
};

const FIELDS: Field[] = [
  {
    key: 'ZAI_API_KEY',
    prompt: 'Z.AI API key (required for OpenCode / GLM-4.7)',
    hint: 'Get from Z.AI console → API Keys',
  },
  {
    key: 'ABUSEIPDB_API_KEY',
    prompt: 'AbuseIPDB API key (required)',
    hint: 'Get from abuseipdb.com → API Key',
  },
  {
    key: 'VIRUSTOTAL_API_KEY',
    prompt: 'VirusTotal API key (required)',
    hint: 'Get from virustotal.com → API Key',
  },
  {
    key: 'AWS_ACCESS_KEY_ID',
    prompt: 'AWS Access Key ID (required for CloudTrail/CloudWatch MCP)',
    hint: 'Create in AWS IAM → Users → Security credentials',
  },
  {
    key: 'AWS_SECRET_ACCESS_KEY',
    prompt: 'AWS Secret Access Key (required)',
    hint: 'Shown once when creating AWS access key',
  },
  {
    key: 'AWS_SESSION_TOKEN',
    prompt: 'AWS Session Token (optional, if using temporary credentials)',
    optional: true,
  },
  {
    key: 'AWS_REGION',
    prompt: 'AWS Region (default: us-east-1)',
    defaultValue: 'us-east-1',
  },
  {
    key: 'AWS_CLOUDTRAIL_MCP_IMAGE',
    prompt: 'CloudTrail MCP image (optional)',
    defaultValue: 'shipsec/mcp-aws-cloudtrail:latest',
    optional: true,
  },
  {
    key: 'AWS_CLOUDWATCH_MCP_IMAGE',
    prompt: 'CloudWatch MCP image (optional)',
    defaultValue: 'shipsec/mcp-aws-cloudwatch:latest',
    optional: true,
  },
];

function loadTemplate(): string {
  if (existsSync(TEMPLATE_PATH)) {
    return readFileSync(TEMPLATE_PATH, 'utf8');
  }
  return '';
}

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  const rl = createInterface({ input, output });
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const existingMap = new Map<string, string>();
  for (const line of existing.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      existingMap.set(match[1], match[2]);
    }
  }

  const lines: string[] = [];
  if (existing.trim().length === 0) {
    const template = loadTemplate();
    if (template.trim().length > 0) {
      lines.push(...template.split(/\r?\n/).filter((l) => !l.startsWith('RUN_E2E=')));
    }
  }

  lines.push('RUN_E2E=true');

  for (const field of FIELDS) {
    const current = existingMap.get(field.key) ?? '';
    const hint = field.hint ? ` (${field.hint})` : '';
    const prompt = `${field.prompt}${hint}${field.defaultValue ? ` [${field.defaultValue}]` : ''}: `;
    const answer = (await rl.question(prompt)).trim();
    const value = answer || current || field.defaultValue || '';

    if (!value && !field.optional) {
      console.error(`Missing required value for ${field.key}.`);
      await rl.close();
      process.exit(1);
    }

    if (!value && field.optional) {
      lines.push(`${field.key}=`);
    } else {
      lines.push(`${field.key}=${value}`);
    }
  }

  await rl.close();
  ensureDir(ENV_PATH);
  writeFileSync(ENV_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`\nWrote ${ENV_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
