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
    });
  });
});
