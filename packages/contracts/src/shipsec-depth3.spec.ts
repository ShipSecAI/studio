import { describe, expect, it } from 'bun:test';
import {
  agentRuntimeManifestSchema,
  agentTaskRequestSchema,
  normalizeAsmIngestion,
  normalizeProwlerCloudIngestion,
  scannerRunSchema,
  shipsecIngestionBatchSchema,
} from './index.js';

const scannerRun = scannerRunSchema().parse({
  id: 'run-depth3',
  organizationId: 'org-1',
  sourceKind: 'prowler',
  sourceVersion: 'prowler-4',
  scope: {
    organizationId: 'org-1',
    provider: 'aws',
    accountId: '123456789012',
  },
  triggerKind: 'workflow',
  status: 'completed',
  startedAt: '2026-04-28T10:00:00.000Z',
  completedAt: '2026-04-28T10:05:00.000Z',
  artifactRefs: [{ uri: 'gcs://shipsec-fixtures/prowler-asff.json', kind: 'raw_scanner_output' }],
});

describe('Depth 3 ingestion contracts', () => {
  it('normalizes Prowler cloud records into the north-star batch shape', () => {
    const batch = normalizeProwlerCloudIngestion({
      scannerRun,
      rawFindings: [
        {
          Id: 'prowler-aws-s3_bucket_public_access',
          Title: 'S3 bucket allows public access',
          Description: 'Bucket policy allows public reads.',
          AwsAccountId: '123456789012',
          Severity: { Label: 'High' },
          Compliance: {
            Status: 'FAILED',
            AssociatedStandards: ['CIS-1.2.0', 'SOC2-CC6.6'],
          },
          Resources: [
            {
              Id: 'arn:aws:s3:::shipsec-public-fixture',
              Type: 'AwsS3Bucket',
              Region: 'us-east-1',
            },
          ],
          Remediation: {
            Recommendation: {
              Text: 'Block public access on the bucket.',
              Url: 'https://hub.prowler.com/check/s3_bucket_public_access',
            },
          },
        },
      ],
    });

    expect(shipsecIngestionBatchSchema().parse(batch).validation.status).toBe('pass');
    expect(batch.stats.rawRecordCount).toBe(1);
    expect(batch.stats.assetCount).toBe(1);
    expect(batch.stats.observationCount).toBe(1);
    expect(batch.stats.findingInstanceCount).toBe(1);
    expect(batch.observations[0]?.normalized).toMatchObject({
      provider: 'aws',
      accountId: '123456789012',
      serviceName: 'S3Bucket',
      compliance: ['FAILED', 'CIS-1.2.0', 'SOC2-CC6.6'],
    });

    const replay = normalizeProwlerCloudIngestion({
      scannerRun,
      rawFindings: batch.observations.map((observation) => observation.normalized.rawFinding),
    });
    expect(replay.id).toBe(batch.id);
    expect(replay.findingInstances[0]?.id).toBe(batch.findingInstances[0]?.id);
  });

  it('keeps repeated Prowler rows insertable and does not create findings for passing checks', () => {
    const failedFinding = {
      Id: 'prowler-aws-s3_bucket_public_access',
      Title: 'S3 bucket allows public access',
      AwsAccountId: '123456789012',
      Severity: { Label: 'High' },
      Compliance: { Status: 'FAILED' },
      Resources: [
        {
          Id: 'arn:aws:s3:::shipsec-public-fixture',
          Type: 'AwsS3Bucket',
          Region: 'us-east-1',
        },
      ],
    };
    const passedFinding = {
      ...failedFinding,
      Id: 'prowler-aws-s3_bucket_encryption',
      Title: 'S3 bucket has encryption enabled',
      Compliance: { Status: 'PASSED' },
    };

    const batch = normalizeProwlerCloudIngestion({
      scannerRun,
      rawFindings: [failedFinding, failedFinding, passedFinding],
    });

    expect(batch.observations).toHaveLength(3);
    expect(new Set(batch.observations.map((observation) => observation.id)).size).toBe(3);
    expect(batch.findingInstances).toHaveLength(1);
    expect(batch.findingInstances[0]?.observationRefs).toHaveLength(2);
    expect(batch.stats.findingInstanceCount).toBe(1);
    expect(batch.stats.passedCount).toBe(1);
    expect(batch.stats.failedCount).toBe(2);
  });

  it('normalizes ASM recon and nuclei records into assets, observations, and findings', () => {
    const asmRun = scannerRunSchema().parse({
      ...scannerRun,
      id: 'run-asm',
      sourceKind: 'asm',
      scope: { organizationId: 'org-1', domain: 'example.com' },
      artifactRefs: [{ uri: 'gcs://shipsec-fixtures/asm.jsonl', kind: 'raw_scanner_output' }],
    });

    const batch = normalizeAsmIngestion({
      scannerRun: asmRun,
      dnsResults: [
        {
          scanner: 'dnsx',
          finding_hash: 'dns-1',
          severity: 'info',
          host: 'admin.example.com',
          answers: { a: ['203.0.113.10'] },
        },
      ],
      httpResults: [
        {
          scanner: 'httpx',
          finding_hash: 'http-1',
          severity: 'info',
          url: 'https://admin.example.com',
          host: 'admin.example.com',
          status_code: 200,
          title: 'Admin Console',
          technologies: ['nginx'],
        },
      ],
      portResults: [
        {
          scanner: 'naabu',
          finding_hash: 'port-1',
          severity: 'info',
          host: 'db.example.com',
          port: 6379,
          protocol: 'tcp',
        },
        {
          scanner: 'naabu',
          finding_hash: 'port-2',
          severity: 'info',
          host: 'www.example.com',
          port: 443,
          protocol: 'tcp',
        },
      ],
      nucleiResults: [
        {
          templateId: 'exposed-admin-panel',
          name: 'Exposed admin panel',
          severity: 'medium',
          matchedAt: 'https://admin.example.com/login',
          host: 'admin.example.com',
          tags: ['exposure'],
        },
      ],
    });

    expect(shipsecIngestionBatchSchema().parse(batch).sourceKind).toBe('asm');
    expect(batch.stats.rawRecordCount).toBe(5);
    expect(batch.assets.length).toBeGreaterThanOrEqual(3);
    expect(batch.observations).toHaveLength(5);
    expect(batch.findingInstances.map((finding) => finding.severity).sort()).toEqual([
      'high',
      'medium',
    ]);
    expect(batch.assets.some((asset) => asset.stableKey.includes('asm:http_service:https'))).toBe(
      true,
    );
  });

  it('keeps agent runtime modes out of the runtime and hangs behavior on skills/workflows', () => {
    const manifest = agentRuntimeManifestSchema().parse({
      id: 'runtime-pi-mono',
      organizationId: 'org-1',
      image: 'ghcr.io/shipsecai/pi-mono:latest',
      toolbeltRefs: ['toolbelt:cloud-readonly'],
      skillRefs: ['skill:code-security-review'],
      workflowRefs: ['workflow:code-review'],
    });

    const request = agentTaskRequestSchema().parse({
      id: 'task-1',
      organizationId: 'org-1',
      runtimeManifestRef: manifest.id,
      trigger: 'workflow',
      skillRef: 'skill:code-security-review',
      objective: 'Review the code diff and emit grounded findings.',
      requestedAt: '2026-04-28T10:00:00.000Z',
    });

    expect(manifest.runtimeKind).toBe('pi_mono_docker');
    expect(manifest.skillRefs).toEqual(['skill:code-security-review']);
    expect((manifest as Record<string, unknown>).modes).toBeUndefined();
    expect(request.skillRef).toBe('skill:code-security-review');
  });
});
