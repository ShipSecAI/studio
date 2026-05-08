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

  it('registers and executes agent code findings normalization', async () => {
    const component = componentRegistry.get('shipsec.agent-code-findings.normalize');
    if (!component) throw new Error('agent code normalizer not registered');

    const context = createExecutionContext({
      runId: 'worker-test-run',
      componentRef: 'agent-code-normalize',
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      workflowName: 'Agentic Code Review',
    });

    const result = (await component.execute(
      {
        inputs: {
          repository: 'shipsec/studio',
          branch: 'main',
          commitSha: 'abc123',
          agentReport: JSON.stringify({
            findings: [
              {
                title: 'Missing tenant authorization on workflow run lookup',
                severity: 'high',
                confidence: 0.91,
                category: 'authorization',
                weaknessClass: 'idor',
                status: 'existing',
                file: 'backend/src/workflows/workflows.controller.ts',
                line: 142,
                endpoint: 'GET /api/v1/workflows/:workflowId/runs/:runId',
                description: 'The route returns a workflow run without proving tenant ownership.',
                attackerPrerequisite: 'Authenticated user in another organization.',
                impact: 'Cross-tenant workflow run metadata exposure.',
                evidence: ['Repository lookup uses runId without organizationId.'],
                fix: 'Scope the lookup by organizationId.',
                verification: 'Add a cross-tenant access regression test.',
              },
            ],
            threatCandidates: [
              {
                title: 'Cross-tenant workflow artifact exposure',
                linkedFindingKeys: [
                  'code:shipsec/studio:idor:GET /api/v1/workflows/:workflowId/runs/:runId',
                ],
                impact: 'Customer workflow metadata can cross tenant boundaries.',
                confidence: 0.8,
              },
            ],
            wikiUpdates: [],
          }),
        },
        params: { reviewMode: 'baseline' },
      },
      context,
    )) as any;

    expect(result.scannerRun.sourceKind).toBe('ai_code_review');
    expect(result.findingCount).toBe(1);
    expect(result.threatCandidateCount).toBe(1);
    expect(result.ingestionBatch.assets.some((asset: any) => asset.assetKind === 'api_route')).toBe(
      true,
    );
    expect(result.ingestionBatch.findingInstances[0]?.findingKey).toContain(
      'code:shipsec/studio:idor:',
    );
    expect(result.ingestionBatch.observations[0]?.normalized.reviewMode).toBe('baseline');
  });

  it('uses linked finding key for agent PR resolution candidates', async () => {
    const component = componentRegistry.get('shipsec.agent-code-findings.normalize');
    if (!component) throw new Error('agent code normalizer not registered');

    const linkedKey = 'code:shipsec/studio:idor:get-/api/invoices/:invoiceid';
    const context = createExecutionContext({
      runId: 'worker-test-pr-run',
      componentRef: 'agent-code-normalize',
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      workflowName: 'Agentic PR Code Review',
    });

    const result = (await component.execute(
      {
        inputs: {
          repository: 'shipsec/studio',
          branch: 'fix-invoice-authz',
          commitSha: 'def456',
          prNumber: 42,
          agentReport: JSON.stringify({
            findings: [
              {
                title: 'Invoice lookup is tenant scoped',
                severity: 'high',
                confidence: 0.86,
                category: 'authorization',
                weaknessClass: 'idor',
                status: 'fixed_candidate',
                file: 'src/app.js',
                line: 7,
                endpoint: 'GET /api/invoices/:invoiceId',
                description: 'The PR adds tenant scoping for the invoice lookup.',
                attackerPrerequisite: 'Authenticated user before the fix.',
                impact: 'Cross-tenant invoice reads are blocked after merge and retest.',
                evidence: ['PR review links back to the baseline finding key.'],
                fix: 'Merge and rerun baseline validation.',
                verification: 'Regression test asserts tenant ownership.',
                linkedFindingKeys: [linkedKey],
              },
            ],
            threatCandidates: [
              {
                title: 'Cross-tenant invoice exposure',
                linkedFindingKeys: [linkedKey],
                impact: 'Customer invoice data exposure.',
                confidence: 0.8,
              },
            ],
            wikiUpdates: [],
          }),
        },
        params: { reviewMode: 'pr' },
      },
      context,
    )) as any;

    expect(result.ingestionBatch.findingInstances[0]?.findingKey).toBe(linkedKey);
    expect(result.ingestionBatch.findingInstances[0]?.status).toBe('in_progress');
    expect(result.ingestionBatch.observations[0]?.normalized.lifecycleHint).toBe('fixed_candidate');
    expect(result.ingestionBatch.observations[0]?.normalized.threatRefs).toEqual([
      'Cross-tenant invoice exposure',
    ]);
  });

  it('accepts abbreviated real agent JSON shapes for code findings', async () => {
    const component = componentRegistry.get('shipsec.agent-code-findings.normalize');
    if (!component) throw new Error('agent code normalizer not registered');

    const context = createExecutionContext({
      runId: 'worker-test-real-agent-run',
      componentRef: 'agent-code-normalize',
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      workflowName: 'Agentic PR Code Review',
    });

    const result = (await component.execute(
      {
        inputs: {
          repository: 'shipsecai/studio',
          branch: 'agent-review-branch',
          commitSha: 'abc123',
          prNumber: 7,
          agentReport: [
            JSON.stringify({
              findings: [
                {
                  id: 'CWE-639',
                  type: 'IDOR',
                  severity: 'HIGH',
                  confidence: 'high',
                  status: 'introduced',
                  file: 'review-fixture/introduced-idor.ts',
                  endpoint: 'GET /api/review-fixture/invoices/:invoiceId',
                  description: 'Invoice lookup does not check tenant ownership.',
                  evidence: 'The route returns any invoice by id.',
                  remediation: 'Scope invoice reads by tenant.',
                },
              ],
              threatCandidates: [
                {
                  type: 'Cross-tenant invoice exposure',
                  actor: 'authenticated tenant user',
                  attackVector: 'guessing invoice ids',
                  description: 'Customer invoice data can be read across tenants.',
                },
              ],
            }),
            JSON.stringify({ wikiUpdates: [] }),
          ].join('\n'),
        },
        params: { reviewMode: 'pr' },
      },
      context,
    )) as any;

    expect(result.findingCount).toBe(1);
    expect(result.threatCandidateCount).toBe(1);
    expect(result.ingestionBatch.findingInstances[0]?.severity).toBe('high');
    expect(result.ingestionBatch.findingInstances[0]?.findingKey).toContain(
      'code:shipsecai/studio:idor:',
    );
    expect(result.ingestionBatch.observations[0]?.normalized.lifecycleHint).toBe('introduced');
    expect(result.ingestionBatch.observations[0]?.normalized.agentFinding.evidence).toEqual([
      'The route returns any invoice by id.',
    ]);
  });
});
