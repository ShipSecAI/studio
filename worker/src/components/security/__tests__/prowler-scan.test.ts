import { describe, expect, it } from 'bun:test';

import { __testables } from '../prowler-scan';

describe('prowler-scan helpers', () => {
  it('buildCommand includes regions only for aws scans', () => {
    const aws = __testables.buildCommand('aws', ['us-east-1'], [], undefined);
    const gcp = __testables.buildCommand('gcp', [], [], undefined);

    expect(aws).toContain('--region');
    expect(aws).toContain('us-east-1');
    expect(gcp.includes('--region')).toBe(false);
  });

  it('prepareScan ignores regions for kubernetes mode', () => {
    const prepared = __testables.prepareScan(
      {
        accountId: undefined,
        credentials: undefined,
        gcpCredential: undefined,
        kubeconfig: 'apiVersion: v1',
        regions: 'us-east-1,us-west-2',
        orgScan: undefined,
      },
      {
        scanMode: 'kubernetes',
        recommendedFlags: [],
        customFlags: undefined,
        orgScan: false,
        memberRoleName: 'OrganizationAccountAccessRole',
        externalId: undefined,
        continueOnError: true,
        skipManagementAccount: false,
        maxConcurrency: 1,
      },
    );

    expect(prepared.regions).toEqual([]);
  });

  it('deriveScanTargetId prefers provider-specific fallback ids', () => {
    const gcpTarget = __testables.deriveScanTargetId(
      {
        accountId: undefined,
        credentials: undefined,
        gcpCredential: {
          targetServiceAccountEmail: 'svc@example.com',
          defaultProjectId: 'demo-project',
          organizationId: undefined,
          clientEmail: undefined,
        },
        kubeconfig: undefined,
        regions: 'us-east-1',
        orgScan: undefined,
      },
      {
        scanMode: 'gcp',
        recommendedFlags: [],
        customFlags: undefined,
        orgScan: false,
        memberRoleName: 'OrganizationAccountAccessRole',
        externalId: undefined,
        continueOnError: true,
        skipManagementAccount: false,
        maxConcurrency: 1,
      },
    );

    const k8sTarget = __testables.deriveScanTargetId(
      {
        accountId: undefined,
        credentials: undefined,
        gcpCredential: undefined,
        kubeconfig: 'apiVersion: v1',
        regions: '',
        orgScan: undefined,
      },
      {
        scanMode: 'kubernetes',
        recommendedFlags: [],
        customFlags: undefined,
        orgScan: false,
        memberRoleName: 'OrganizationAccountAccessRole',
        externalId: undefined,
        continueOnError: true,
        skipManagementAccount: false,
        maxConcurrency: 1,
      },
    );

    expect(gcpTarget).toBe('demo-project');
    expect(k8sTarget).toBe('kubernetes');
  });
});
