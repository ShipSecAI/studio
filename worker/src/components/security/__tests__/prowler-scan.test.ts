import { describe, expect, it } from 'bun:test';

import { __testables } from '../prowler-scan';

describe('prowler-scan helpers', () => {
  it('buildCommand includes regions only for aws scans', () => {
    const aws = __testables.buildCommand('aws', ['us-east-1'], [], undefined);
    const gcp = __testables.buildCommand('gcp', [], [], undefined);

    expect(aws).toContain('--region');
    expect(aws).toContain('us-east-1');
    expect(gcp.includes('--region')).toBe(false);
    expect(aws).toContain('json-ocsf');
    expect(gcp).toContain('json-ocsf');
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

  it('buildAnalyticsResults forwards Prowler check and compliance metadata', () => {
    const [row] = __testables.buildAnalyticsResults([
      {
        id: 'prowler-aws-iam_user_no_administrator_access-726751758435-pranjal',
        title: 'IAM user does not have AdministratorAccess policy attached',
        accountId: '726751758435',
        resourceId: 'arn:aws:iam::726751758435:user/pranjal',
        region: 'global',
        serviceName: 'IamUser',
        severity: 'critical',
        status: 'FAILED',
        description: 'IAM users should not have administrative privileges.',
        remediationText: 'Remove AdministratorAccess from IAM users.',
        recommendationUrl: 'https://hub.prowler.com/check/iam_user_no_administrator_access',
        checkId: 'iam_user_no_administrator_access',
        checkName: 'IAM user does not have AdministratorAccess policy attached',
        ruleId: 'iam_user_no_administrator_access',
        provider: 'aws',
        resourceType: 'AwsIamUser',
        compliance: ['cis_1.16', 'soc2_CC6.1'],
        resourceTags: { owner: 'platform', env: 'prod' },
        rawFinding: { Id: 'native-id', ProductFields: { ProwlerCheckID: 'check' } },
      },
    ]);

    expect(row).toMatchObject({
      scanner: 'prowler',
      severity: 'critical',
      asset_key: 'arn:aws:iam::726751758435:user/pranjal',
      provider: 'aws',
      rule_id: 'iam_user_no_administrator_access',
      check_id: 'iam_user_no_administrator_access',
      check_name: 'IAM user does not have AdministratorAccess policy attached',
      account_id: '726751758435',
      region: 'global',
      service_name: 'IamUser',
      status: 'FAILED',
      compliance: ['cis_1.16', 'soc2_CC6.1'],
      resource_tags: { owner: 'platform', env: 'prod' },
      native_finding_id: 'prowler-aws-iam_user_no_administrator_access-726751758435-pranjal',
      resource_type: 'AwsIamUser',
      raw_finding: { Id: 'native-id', ProductFields: { ProwlerCheckID: 'check' } },
    });
    expect(row.finding_hash).toHaveLength(16);
  });
});
