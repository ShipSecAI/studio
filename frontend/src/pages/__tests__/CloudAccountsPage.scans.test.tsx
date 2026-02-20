import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mockRefetch = mock(() => Promise.resolve());

const mockCloudScansState = {
  data: {
    runs: [
      {
        id: 'run-1',
        workflowId: 'wf-1',
        workflowName: 'Cloud Scan Workflow',
        status: 'COMPLETED',
        startTime: '2026-02-19T10:00:00.000Z',
        endTime: '2026-02-19T10:05:00.000Z',
        duration: 300000,
        nodeCount: 12,
        eventCount: 25,
        createdAt: '2026-02-19T10:00:00.000Z',
        isLive: false,
        workflowVersionId: null,
        workflowVersion: 1,
        triggerType: 'manual',
        triggerSource: null,
        triggerLabel: 'Manual run',
        inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
      },
    ],
    liveCount: 0,
    successRate: 100,
    totalFetched: 1,
  },
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  dataUpdatedAt: Date.now(),
  refetch: mockRefetch,
};

const githubStoreState = {
  fetchSystemWorkflows: () => {},
  systemWorkflows: [{ id: 'wf-1', slug: 'sys-cloud-security-scan' }],
  systemWorkflowsLoading: false,
};

mock.module('@/hooks/queries/useCloudScanQueries', () => ({
  useCloudScans: () => mockCloudScansState,
}));

mock.module('@/store/githubStore', () => ({
  useGitHubStore: (selector: any) => selector(githubStoreState),
}));

mock.module('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

mock.module('@/components/scans/CloudScanDetailPanel', () => ({
  CloudScanDetailPanel: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div data-testid="cloud-scan-detail-panel">
      <span>{runId}</span>
      <button onClick={onClose}>Close panel</button>
    </div>
  ),
}));

import { ScansTab } from '@/pages/CloudAccountsPage';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

describe('CloudAccountsPage ScansTab URL state', () => {
  beforeEach(() => {
    mockRefetch.mockClear();
  });

  it('opens the detail panel when scan is provided in URL and removes it on close', () => {
    render(
      <MemoryRouter initialEntries={['/cloud/accounts?tab=scans&scan=run-1']}>
        <LocationProbe />
        <ScansTab connections={[{ id: 'conn-1', provider: 'aws' }]} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('cloud-scan-detail-panel')).toBeInTheDocument();
    expect(screen.getByText('run-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));

    const nextSearch = screen.getByTestId('location-search').textContent ?? '';
    expect(nextSearch).toContain('tab=scans');
    expect(nextSearch).not.toContain('scan=');
  });

  it('sets scan param when clicking a run row', () => {
    render(
      <MemoryRouter initialEntries={['/cloud/accounts?tab=scans']}>
        <LocationProbe />
        <ScansTab connections={[{ id: 'conn-1', provider: 'aws' }]} />
      </MemoryRouter>,
    );

    const row = screen.getByText('Cloud Scan Workflow').closest('tr');
    if (!row) {
      throw new Error('Expected run row to exist');
    }
    fireEvent.click(row);

    const nextSearch = screen.getByTestId('location-search').textContent ?? '';
    expect(nextSearch).toContain('tab=scans');
    expect(nextSearch).toContain('scan=run-1');
    expect(screen.getByTestId('cloud-scan-detail-panel')).toBeInTheDocument();
  });
});
