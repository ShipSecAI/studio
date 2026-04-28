import { beforeAll, describe, expect, it } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('ShipSec north-star ingestion normalizers', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('registers and executes cloud findings normalization', async () => {
    const component = componentRegistry.get('shipsec.cloud-findings.normalize');
    if (!component) throw new Error('cloud normalizer not registered');

    const context = createExecutionContext({
      runId: 'worker-test-run',
      componentRef: 'cloud-normalize',
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      workflowName: 'Cloud Validation',
    });

    const result = (await component.execute(
      {
        inputs: {
          scanId: 'prowler-worker-test',
          accountId: '123456789012',
          provider: 'aws',
          rawFindings: [
            {
              Id: 'prowler-aws-iam_mfa_enabled',
              Title: 'MFA is not enabled for root account',
              AwsAccountId: '123456789012',
              Severity: { Label: 'Critical' },
              Compliance: { Status: 'FAILED', AssociatedStandards: ['CIS-1.5'] },
              Resources: [
                {
                  Id: 'arn:aws:iam::123456789012:root',
                  Type: 'AwsIamAccount',
                  Region: 'global',
                },
              ],
            },
          ],
          rawArtifactUri: 'gcs://fixture/prowler.json',
        },
        params: {},
      },
      context,
    )) as any;

    expect(result.scannerRun.sourceKind).toBe('prowler');
    expect(result.assetCount).toBe(1);
    expect(result.observationCount).toBe(1);
    expect(result.findingCount).toBe(1);
    expect(result.ingestionBatch.validation.status).toBe('pass');
  });

  it('registers and executes ASM findings normalization', async () => {
    const component = componentRegistry.get('shipsec.asm-findings.normalize');
    if (!component) throw new Error('ASM normalizer not registered');

    const context = createExecutionContext({
      runId: 'worker-test-run',
      componentRef: 'asm-normalize',
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      workflowName: 'ASM Validation',
    });

    const result = (await component.execute(
      {
        inputs: {
          scanId: 'asm-worker-test',
          domain: 'example.com',
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
            },
          ],
          portResults: [
            {
              scanner: 'naabu',
              finding_hash: 'port-1',
              severity: 'info',
              host: 'cache.example.com',
              port: 6379,
              protocol: 'tcp',
            },
          ],
        },
        params: {},
      },
      context,
    )) as any;

    expect(result.scannerRun.sourceKind).toBe('asm');
    expect(result.assetCount).toBe(3);
    expect(result.observationCount).toBe(3);
    expect(result.findingCount).toBe(1);
    expect(result.ingestionBatch.findingInstances[0]?.findingKey).toContain('asm.open_port');
  });
});
