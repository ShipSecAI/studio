import { describe, expect, it } from 'bun:test';
import { normaliseFindings, shouldSetVolumeOwnershipForExecutionMode } from '../prowler-shared';

describe('prowler shared helpers', () => {
  it('skips Docker-only output ownership preparation in k8s mode', () => {
    expect(shouldSetVolumeOwnershipForExecutionMode('k8s')).toBe(false);
  });

  it('keeps output ownership preparation enabled for docker-style execution', () => {
    expect(shouldSetVolumeOwnershipForExecutionMode('docker')).toBe(true);
    expect(shouldSetVolumeOwnershipForExecutionMode(undefined)).toBe(true);
  });

  it('normalises GCP OCSF findings from Prowler', () => {
    const { findings, errors } = normaliseFindings(
      [
        JSON.stringify([
          {
            message: 'Project shipsec does not have Audit Logs enabled.',
            metadata: { event_code: 'cloudstorage_audit_logs_enabled' },
            severity: 'Medium',
            severity_id: 3,
            status_code: 'FAIL',
            finding_info: {
              uid: 'prowler-gcp-cloudstorage_audit_logs_enabled-shipsec',
              title: 'Data Access audit logs are enabled for Cloud Storage',
              desc: 'Data Access audit logs are enabled for Cloud Storage at the project level.',
            },
            cloud: {
              account: { uid: 'shipsec', name: 'ShipSec' },
              provider: 'gcp',
              region: 'global',
            },
            resources: [
              {
                uid: 'shipsec',
                name: 'ShipSec',
                type: 'cloudresourcemanager.googleapis.com/Project',
                region: 'global',
                group: { name: 'cloudstorage' },
              },
            ],
            remediation: {
              desc: 'Enable Data Access audit logs.',
              references: ['https://hub.prowler.com/check/cloudstorage_audit_logs_enabled'],
            },
          },
        ]),
      ],
      'run-1',
    );

    expect(errors).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'prowler-gcp-cloudstorage_audit_logs_enabled-shipsec',
      accountId: 'shipsec',
      resourceId: 'shipsec',
      region: 'global',
      serviceName: 'cloudstorage',
      severity: 'medium',
      status: 'FAILED',
      remediationText: 'Enable Data Access audit logs.',
      recommendationUrl: 'https://hub.prowler.com/check/cloudstorage_audit_logs_enabled',
      checkId: 'cloudstorage_audit_logs_enabled',
      checkName: 'Data Access audit logs are enabled for Cloud Storage',
      provider: 'gcp',
      resourceType: 'cloudresourcemanager.googleapis.com/Project',
    });
  });

  it('preserves AWS ASFF check identity, compliance tags, resource tags, and raw metadata', () => {
    const { findings, errors } = normaliseFindings(
      [
        JSON.stringify([
          {
            Id: 'prowler-aws-iam_user_no_administrator_access-726751758435-pranjal',
            GeneratorId: 'iam_user_no_administrator_access',
            Title: 'IAM user does not have AdministratorAccess policy attached',
            Description: 'IAM users should not have administrative privileges.',
            AwsAccountId: '726751758435',
            ProductFields: {
              ProwlerCheckID: 'iam_user_no_administrator_access',
              ProwlerCheckTitle: 'IAM user does not have AdministratorAccess policy attached',
              ProwlerComplianceFramework: 'cis_aws_foundations_benchmark_1.4',
              ProwlerComplianceRequirement: 'cis_1.16',
            },
            Severity: { Label: 'CRITICAL', Normalized: 95 },
            Compliance: {
              Status: 'FAILED',
              RelatedRequirements: ['nist_800_53_AC-6', 'soc2_CC6.1'],
              AssociatedStandards: [{ StandardsId: 'aws-foundational-security-best-practices' }],
            },
            Resources: [
              {
                Id: 'arn:aws:iam::726751758435:user/pranjal',
                Type: 'AwsIamUser',
                Region: 'global',
                Tags: { owner: 'platform', env: 'prod' },
              },
            ],
            Remediation: {
              Recommendation: {
                Text: 'Remove AdministratorAccess from IAM users.',
                Url: 'https://hub.prowler.com/check/iam_user_no_administrator_access',
              },
            },
          },
        ]),
      ],
      'run-aws',
    );

    expect(errors).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'prowler-aws-iam_user_no_administrator_access-726751758435-pranjal',
      checkId: 'iam_user_no_administrator_access',
      checkName: 'IAM user does not have AdministratorAccess policy attached',
      ruleId: 'iam_user_no_administrator_access',
      accountId: '726751758435',
      resourceId: 'arn:aws:iam::726751758435:user/pranjal',
      resourceType: 'AwsIamUser',
      region: 'global',
      serviceName: 'IamUser',
      severity: 'critical',
      status: 'FAILED',
      provider: 'aws',
      resourceTags: { owner: 'platform', env: 'prod' },
    });
    expect(findings[0].compliance).toEqual([
      'aws-foundational-security-best-practices',
      'cis_1.16',
      'cis_aws_foundations_benchmark_1.4',
      'nist_800_53_AC-6',
      'soc2_CC6.1',
    ]);
  });
});
