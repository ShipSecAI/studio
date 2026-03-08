import { describe, expect, it } from 'bun:test';
import { shouldSetVolumeOwnershipForExecutionMode } from '../prowler-shared';

describe('prowler shared helpers', () => {
  it('skips Docker-only output ownership preparation in k8s mode', () => {
    expect(shouldSetVolumeOwnershipForExecutionMode('k8s')).toBe(false);
  });

  it('keeps output ownership preparation enabled for docker-style execution', () => {
    expect(shouldSetVolumeOwnershipForExecutionMode('docker')).toBe(true);
    expect(shouldSetVolumeOwnershipForExecutionMode(undefined)).toBe(true);
  });
});
