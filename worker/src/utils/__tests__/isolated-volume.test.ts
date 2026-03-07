import { afterEach, describe, expect, it } from 'bun:test';

import { resolveVolumeSource } from '../isolated-volume';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env.EXECUTION_MODE = ORIGINAL_ENV.EXECUTION_MODE;
  process.env.GCS_VOLUME_BUCKET = ORIGINAL_ENV.GCS_VOLUME_BUCKET;
});

describe('resolveVolumeSource', () => {
  it('passes through docker volume names outside k8s mode', () => {
    process.env.EXECUTION_MODE = 'docker';
    process.env.GCS_VOLUME_BUCKET = 'shipsec-volumes-staging';

    expect(resolveVolumeSource('tenant-org-run-123')).toBe('tenant-org-run-123');
  });

  it('expands raw volume names to gcsfuse sources in k8s mode', () => {
    process.env.EXECUTION_MODE = 'k8s';
    process.env.GCS_VOLUME_BUCKET = 'shipsec-volumes-staging';

    expect(resolveVolumeSource('shipsec-run-abc/shipsec-run-abc/123')).toBe(
      'gcsfuse:shipsec-volumes-staging:shipsec-run-abc/shipsec-run-abc/123',
    );
  });

  it('expands raw volume names to configmap sources in k8s mode without GCS', () => {
    process.env.EXECUTION_MODE = 'k8s';
    delete process.env.GCS_VOLUME_BUCKET;

    expect(resolveVolumeSource('vol-test-run-123')).toBe('configmap:vol-test-run-123');
  });

  it('passes through already-qualified sources unchanged', () => {
    process.env.EXECUTION_MODE = 'k8s';
    process.env.GCS_VOLUME_BUCKET = 'shipsec-volumes-staging';

    expect(resolveVolumeSource('gcsfuse:bucket:prefix')).toBe('gcsfuse:bucket:prefix');
    expect(resolveVolumeSource('configmap:vol-test')).toBe('configmap:vol-test');
  });
});
