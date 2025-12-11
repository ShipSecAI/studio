import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { WorkflowSchedule } from '@shipsec/shared'

import { resetScheduleStoreState, useScheduleStore } from '../scheduleStore'

const now = new Date().toISOString()

const baseSchedule: WorkflowSchedule = {
  id: '11111111-1111-4111-8111-111111111111',
  workflowId: '22222222-2222-4222-8222-222222222222',
  workflowVersionId: '33333333-3333-4333-8333-333333333333',
  workflowVersion: 1,
  name: 'Daily Quick Scan',
  description: null,
  cronExpression: '0 9 * * *',
  timezone: 'UTC',
  humanLabel: null,
  overlapPolicy: 'skip',
  catchupWindowSeconds: 0,
  status: 'active',
  lastRunAt: null,
  nextRunAt: null,
  inputPayload: { runtimeInputs: { domain: 'acme.com' }, nodeOverrides: {} },
  temporalScheduleId: null,
  temporalSnapshot: {},
  organizationId: 'local-dev',
  createdAt: now,
  updatedAt: now,
}

const listMock = mock(async () => [baseSchedule])
const pauseMock = mock(async () => ({ ...baseSchedule, status: 'paused' as const }))
const resumeMock = mock(async () => ({ ...baseSchedule, status: 'active' as const }))
const runNowCalls: string[] = []
const runNowMock = mock(async (id: string) => {
  runNowCalls.push(id)
})

mock.module('@/services/api', () => ({
  api: {
    schedules: {
      list: listMock,
      pause: pauseMock,
      resume: resumeMock,
      runNow: runNowMock,
    },
  },
}))

describe('scheduleStore', () => {
  beforeEach(() => {
    resetScheduleStoreState()
    listMock.mockReset()
    pauseMock.mockReset()
    resumeMock.mockReset()
    runNowMock.mockReset()
    listMock.mockImplementation(async () => [baseSchedule])
    pauseMock.mockImplementation(async () => ({ ...baseSchedule, status: 'paused' }))
    resumeMock.mockImplementation(async () => ({ ...baseSchedule, status: 'active' }))
    runNowCalls.length = 0
    runNowMock.mockImplementation(async (id: string) => {
      runNowCalls.push(id)
    })
  })

  it('fetches schedules once while cache is fresh', async () => {
    await useScheduleStore.getState().fetchSchedules()
    await useScheduleStore.getState().fetchSchedules()
    expect(listMock.mock.calls.length).toBe(1)
  })

  it('forces refresh when requested', async () => {
    await useScheduleStore.getState().fetchSchedules()
    listMock.mockClear()
    await useScheduleStore.getState().fetchSchedules({ force: true })
    expect(listMock.mock.calls.length).toBe(1)
  })

  it('updates local state when pausing and resuming schedules', async () => {
    useScheduleStore.setState({ schedules: [baseSchedule] })

    const paused = await useScheduleStore.getState().pauseSchedule(baseSchedule.id)
    expect(paused.status).toBe('paused')
    expect(useScheduleStore.getState().schedules[0]?.status).toBe('paused')

    const resumed = await useScheduleStore.getState().resumeSchedule(baseSchedule.id)
    expect(resumed.status).toBe('active')
    expect(useScheduleStore.getState().schedules[0]?.status).toBe('active')
  })

  it('runs schedules via API without mutating cache', async () => {
    await useScheduleStore.getState().runSchedule(baseSchedule.id)
    expect(runNowCalls.length).toBe(1)
    expect(runNowCalls[0]).toBe(baseSchedule.id)
    expect(useScheduleStore.getState().schedules).toHaveLength(0)
  })

  it('merges filters without resetting other state', () => {
    useScheduleStore.getState().setFilters({ workflowId: baseSchedule.workflowId })
    useScheduleStore.getState().setFilters({ status: 'paused' })

    const filters = useScheduleStore.getState().filters
    expect(filters.workflowId).toBe(baseSchedule.workflowId)
    expect(filters.status).toBe('paused')
    expect(filters.search).toBe('')
  })
})
