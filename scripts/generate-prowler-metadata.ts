#!/usr/bin/env bun
/**
 * Generates a static JSON file mapping Prowler check IDs to their remediation metadata.
 *
 * Usage:
 *   bun scripts/generate-prowler-metadata.ts
 *
 * This script:
 *   1. Creates a temporary container from the Prowler Docker image
 *   2. Copies provider metadata files out of the container
 *   3. Extracts Remediation.Code and Remediation.Recommendation from each
 *   4. Writes backend/src/assets/prowler-checks.json
 *
 * Run this whenever the Prowler Docker image is updated.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PROWLER_IMAGE = 'ghcr.io/shipsecai/prowler:latest';
const OUTPUT_PATH = join(__dirname, '..', 'backend', 'src', 'assets', 'prowler-checks.json');

interface CheckMetadata {
  checkTitle: string | null;
  recommendation: string | null;
  recommendationUrl: string | null;
  cli: string | null;
  nativeIaC: string | null;
  terraform: string | null;
  other: string | null;
}

function main() {
  console.log(`Pulling image: ${PROWLER_IMAGE}`);
  execSync(`docker pull ${PROWLER_IMAGE}`, { stdio: 'inherit' });

  console.log('Creating temporary container...');
  const containerId = execSync(`docker create ${PROWLER_IMAGE} --help`, {
    encoding: 'utf-8',
  }).trim();

  const tmpDir = execSync('mktemp -d', { encoding: 'utf-8' }).trim();

  try {
    console.log('Copying provider metadata from container...');
    execSync(`docker cp ${containerId}:/home/prowler/prowler/providers ${tmpDir}/providers`, {
      stdio: 'inherit',
    });

    console.log('Finding metadata files...');
    const fileList = execSync(
      `find ${tmpDir}/providers -name '*.metadata.json' -type f`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    ).trim();

    const files = fileList ? fileList.split('\n').filter(Boolean) : [];
    console.log(`Found ${files.length} metadata files`);

    const result: Record<string, CheckMetadata> = {};
    let skipped = 0;

    for (const filePath of files) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const checkId = parsed.CheckID;
        if (!checkId) {
          skipped++;
          continue;
        }

        const remediation = parsed.Remediation ?? {};
        const recommendation = remediation.Recommendation ?? {};
        const code = remediation.Code ?? {};

        result[checkId] = {
          checkTitle: parsed.CheckTitle || null,
          recommendation: recommendation.Text || null,
          recommendationUrl: recommendation.Url || null,
          cli: code.CLI || null,
          nativeIaC: code.NativeIaC || null,
          terraform: code.Terraform || null,
          other: code.Other || null,
        };
      } catch {
        skipped++;
      }
    }

    const count = Object.keys(result).length;
    console.log(`Extracted ${count} checks (skipped ${skipped})`);

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n');

    const sizeKb = Math.round(Buffer.byteLength(JSON.stringify(result)) / 1024);
    console.log(`Written to ${OUTPUT_PATH} (~${sizeKb}KB)`);
  } finally {
    execSync(`rm -rf ${tmpDir}`);
    execSync(`docker rm ${containerId}`, { stdio: 'inherit' });
    console.log('Cleaned up.');
  }
}

main();
