import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { RUNS_STALE_MS, resetRunStoreState, useRunStore } from '../runStore'

const mockRun = {
  id: 'run-1',
  workflowId: 'wf-1',
  workflowName: 'Example workflow',
  status: 'RUNNING',
  startTime: '2024-01-01T00:00:00.000Z',
  nodeCount: 3,
  eventCount: 10,
}

const listRunsMock = mock(async () => ({
  runs: [mockRun],
}))

mock.module('@/services/api', () => ({
  api: {
    executions: {
      listRuns: listRunsMock,
    },
  },
}))

describe('runStore', () => {
  beforeEach(() => {
    resetRunStoreState()
    listRunsMock.mockReset()
    listRunsMock.mockImplementation(async () => ({ runs: [mockRun] }))
  })

  it('dedupes concurrent fetches per workflow', async () => {
    listRunsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { runs: [mockRun] }
    })

    await Promise.all([
      useRunStore.getState().fetchRuns({ workflowId: 'wf-1' }),
      useRunStore.getState().fetchRuns({ workflowId: 'wf-1' }),
    ])

    expect(listRunsMock.mock.calls.length).toBe(1)
  })

  it('maintains independent caches per workflow', async () => {
    await useRunStore.getState().fetchRuns({ workflowId: 'wf-1' })
    listRunsMock.mockClear()

    await useRunStore.getState().fetchRuns({ workflowId: 'wf-2' })
    expect(listRunsMock.mock.calls.length).toBe(1)
  })

  it('skips network when a workflow cache is still fresh', async () => {
    await useRunStore.getState().fetchRuns({ workflowId: 'wf-1' })
    expect(listRunsMock.mock.calls.length).toBe(1)

    listRunsMock.mockClear()
    await useRunStore.getState().fetchRuns({ workflowId: 'wf-1' })
    expect(listRunsMock.mock.calls.length).toBe(0)
  })

  it('forces a refresh when requested', async () => {
    await useRunStore.getState().fetchRuns({ workflowId: 'wf-1' })
    listRunsMock.mockClear()

    await useRunStore.getState().fetchRuns({ workflowId: 'wf-1', force: true })
    expect(listRunsMock.mock.calls.length).toBe(1)
  })

  it('allows manual invalidation across caches', async () => {
    await useRunStore.getState().fetchRuns({ workflowId: 'wf-1' })
    listRunsMock.mockClear()

    useRunStore.getState().invalidate()
    await useRunStore.getState().fetchRuns({ workflowId: 'wf-1' })
    expect(listRunsMock.mock.calls.length).toBe(1)
  })

  it('upserts runs into workflow caches in sorted order', () => {
    const store = useRunStore.getState()
    store.upsertRun({
      id: 'run-new',
      workflowId: 'wf-1',
      workflowName: 'Example workflow',
      status: 'COMPLETED',
      startTime: new Date(Date.now() - RUNS_STALE_MS).toISOString(),
      nodeCount: 1,
      eventCount: 1,
      createdAt: new Date().toISOString(),
      isLive: false,
      workflowVersionId: null,
      workflowVersion: null,
    })

    store.upsertRun({
      id: 'run-earlier',
      workflowId: 'wf-1',
      workflowName: 'Example workflow',
      status: 'FAILED',
      startTime: '2023-12-31T00:00:00.000Z',
      nodeCount: 1,
      eventCount: 1,
      createdAt: '2023-12-31T00:00:00.000Z',
      isLive: false,
      workflowVersionId: null,
      workflowVersion: null,
    })

    const runs = useRunStore.getState().getRunsForWorkflow('wf-1')
    expect(runs[0].id).toBe('run-new')

    store.upsertRun({
      ...runs[0],
      status: 'FAILED',
    })

    expect(useRunStore.getState().getRunsForWorkflow('wf-1')[0].status).toBe('FAILED')
  })
})
