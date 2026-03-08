import { afterEach, beforeAll, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';

const mockVolume = {
  initialize: vi.fn(async () => 'mock-volume'),
  readFiles: vi.fn(async () => ({
    'commit_sha.txt': 'abc123\n',
    'branch.txt': 'main\n',
  })),
  getVolumeConfig: vi.fn((containerPath = '/workspace', readOnly = false) => ({
    source: 'mock-volume',
    target: containerPath,
    readOnly,
  })),
  cleanup: vi.fn(async () => {}),
  getVolumeName: vi.fn(() => 'mock-volume'),
};

mock.module('../../../utils/isolated-volume', () => ({
  createIsolatedVolume: () => mockVolume,
}));

describe('github.repo.clone component', () => {
  let componentRegistry: typeof import('@shipsec/component-sdk').componentRegistry;

  beforeAll(async () => {
    ({ componentRegistry } = await import('../../index'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.values(mockVolume).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        (value as ReturnType<typeof vi.fn>).mockClear();
      }
    });
  });

  it('marks /workspace/repo as a safe git directory before follow-up git commands', async () => {
    const component = componentRegistry.get('github.repo.clone');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'github-clone-test',
    });

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({
      exitCode: 0,
      stderr: '',
      raw: '',
    });

    const result = (await component.execute(
      {
        inputs: {
          repository: 'octocat/Hello-World',
          ref: 'refs/heads/main',
        },
        params: {},
      },
      context,
    )) as { commitSha: string; branch: string };

    const runnerConfig = runSpy.mock.calls[0]?.[0] as { command?: string[] };
    const shellCommand = runnerConfig.command?.[1] ?? '';

    expect(shellCommand).toContain('git config --global --add safe.directory /workspace/repo');
    expect(shellCommand).toContain('cd /workspace/repo && git checkout "$GIT_REF"');
    expect(
      shellCommand.indexOf('git config --global --add safe.directory /workspace/repo'),
    ).toBeLessThan(shellCommand.indexOf('cd /workspace/repo && git checkout "$GIT_REF"'));
    expect(result.commitSha).toBe('abc123');
    expect(result.branch).toBe('main');
  });
});
