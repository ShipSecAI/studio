import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { api } from '@/services/api'
import type { ExecutionStatus } from '@/schemas/execution'

export interface ExecutionRun {
  id: string
  workflowId: string
  workflowName: string
  status: ExecutionStatus
  startTime: string
  endTime?: string
  duration?: number
  nodeCount: number
  eventCount: number
  createdAt: string
  isLive: boolean
  workflowVersionId: string | null
  workflowVersion: number | null
}

interface RunStoreState {
  runs: ExecutionRun[]
  isLoading: boolean
  error: string | null
  lastFetched: number | null
}

interface RunStoreActions {
  fetchRuns: (options?: { force?: boolean }) => Promise<ExecutionRun[] | undefined>
  refreshRuns: () => Promise<ExecutionRun[] | undefined>
  invalidate: () => void
  upsertRun: (run: ExecutionRun) => void
  getRunById: (runId: string) => ExecutionRun | undefined
  getLatestRun: () => ExecutionRun | undefined
}

export type RunStore = RunStoreState & RunStoreActions

const INITIAL_STATE: RunStoreState = {
  runs: [],
  isLoading: false,
  error: null,
  lastFetched: null,
}

export const RUNS_STALE_MS = 30_000

let inflightFetch: Promise<ExecutionRun[]> | null = null

const normalizeRun = (run: any): ExecutionRun => {
  const startTime = typeof run.startTime === 'string' ? run.startTime : new Date().toISOString()
  const endTime = typeof run.endTime === 'string' ? run.endTime : undefined
  const status = (typeof run.status === 'string' ? run.status.toUpperCase() : 'FAILED') as ExecutionStatus
  const derivedDuration =
    typeof run.duration === 'number'
      ? run.duration
      : endTime
        ? new Date(endTime).getTime() - new Date(startTime).getTime()
        : Date.now() - new Date(startTime).getTime()

  return {
    id: String(run.id ?? ''),
    workflowId: String(run.workflowId ?? ''),
    workflowName: String(run.workflowName ?? 'Untitled workflow'),
    status,
    startTime,
    endTime,
    duration: Number.isFinite(derivedDuration) ? derivedDuration : undefined,
    nodeCount: typeof run.nodeCount === 'number' ? run.nodeCount : 0,
    eventCount: typeof run.eventCount === 'number' ? run.eventCount : 0,
    createdAt: startTime,
    isLive: !endTime && status === 'RUNNING',
    workflowVersionId: typeof run.workflowVersionId === 'string' ? run.workflowVersionId : null,
    workflowVersion: typeof run.workflowVersion === 'number' ? run.workflowVersion : null,
  }
}

const sortRuns = (runs: ExecutionRun[]): ExecutionRun[] => {
  return [...runs].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  )
}

export const useRunStore = create<RunStore>()(
  subscribeWithSelector((set, get) => ({
    ...INITIAL_STATE,

    fetchRuns: async (options) => {
      const force = options?.force ?? false
      const state = get()
      const now = Date.now()

      if (!force) {
        if (state.isLoading && inflightFetch) {
          return inflightFetch
        }
        if (state.lastFetched && now - state.lastFetched < RUNS_STALE_MS) {
          return state.runs
        }
        if (inflightFetch) {
          return inflightFetch
        }
      }

      set({ isLoading: true, error: null })

      inflightFetch = (async () => {
        try {
          const response = await api.executions.listRuns({ limit: 50 })
          const normalized = sortRuns((response.runs ?? []).map(normalizeRun))
          set({
            runs: normalized,
            lastFetched: Date.now(),
            isLoading: false,
            error: null,
          })
          return normalized
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch runs'
          set({
            error: message,
            isLoading: false,
          })
          throw error
        } finally {
          inflightFetch = null
        }
      })()

      try {
        return await inflightFetch
      } catch (error) {
        throw error
      }
    },

    refreshRuns: () => get().fetchRuns({ force: true }),

    invalidate: () => {
      set({ lastFetched: null, error: null })
    },

    upsertRun: (run: ExecutionRun) => {
      set((state) => {
        const existingIndex = state.runs.findIndex((item) => item.id === run.id)
        if (existingIndex === -1) {
          return { runs: sortRuns([...state.runs, run]) }
        }
        const updated = [...state.runs]
        updated[existingIndex] = {
          ...updated[existingIndex],
          ...run,
          status: run.status,
        }
        return { runs: sortRuns(updated) }
      })
    },

    getRunById: (runId: string) => {
      return get().runs.find((run) => run.id === runId)
    },

    getLatestRun: () => {
      const [latest] = get().runs
      return latest
    },
  }))
)

export const resetRunStoreState = () => {
  inflightFetch = null
  useRunStore.setState({ ...INITIAL_STATE })
}
