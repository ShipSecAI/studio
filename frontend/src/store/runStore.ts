import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { api } from '@/services/api'
import type { ExecutionStatus } from '@/schemas/execution'
import type { ExecutionTriggerType, ExecutionInputPreview } from '@shipsec/shared'

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
  triggerType: ExecutionTriggerType
  triggerSource: string | null
  triggerLabel: string | null
  inputPreview: ExecutionInputPreview
  parentRunId?: string | null
  parentNodeRef?: string | null
}

interface RunCacheEntry {
  runs: ExecutionRun[]
  isLoading: boolean
  error: string | null
  lastFetched: number | null
}

interface RunStoreState {
  cache: Record<string, RunCacheEntry>
}

interface RunStoreActions {
  fetchRuns: (options?: { workflowId?: string | null; force?: boolean }) => Promise<ExecutionRun[] | undefined>
  refreshRuns: (workflowId?: string | null) => Promise<ExecutionRun[] | undefined>
  invalidate: (workflowId?: string | null) => void
  upsertRun: (run: ExecutionRun) => void
  getRunById: (runId: string) => ExecutionRun | undefined
  getLatestRun: (workflowId?: string | null) => ExecutionRun | undefined
  getRunsForWorkflow: (workflowId?: string | null) => ExecutionRun[]
}

export type RunStore = RunStoreState & RunStoreActions

const INITIAL_STATE: RunStoreState = {
  cache: {},
}

export const RUNS_STALE_MS = 30_000

const GLOBAL_WORKFLOW_CACHE_KEY = '__global__'

const getCacheKey = (workflowId?: string | null) => workflowId ?? GLOBAL_WORKFLOW_CACHE_KEY

const createEmptyEntry = (): RunCacheEntry => ({
  runs: [],
  isLoading: false,
  error: null,
  lastFetched: null,
})

const getEntry = (cache: RunStoreState['cache'], key: string): RunCacheEntry => {
  return cache[key] ?? createEmptyEntry()
}

const inflightFetches = new Map<string, Promise<ExecutionRun[]>>()

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']

const TRIGGER_LABELS: Record<ExecutionTriggerType, string> = {
  manual: 'Manual run',
  schedule: 'Scheduled run',
  api: 'API run',
}

const normalizeRun = (run: any): ExecutionRun => {
  const startTime = typeof run.startTime === 'string' ? run.startTime : new Date().toISOString()
  const rawEndTime = typeof run.endTime === 'string' ? run.endTime : undefined
  const status = (typeof run.status === 'string' ? run.status.toUpperCase() : 'FAILED') as ExecutionStatus
  const isActiveStatus = !TERMINAL_STATUSES.includes(status)

  // Backend now calculates duration from events, so use it directly
  // Fallback to calculating from endTime if duration not provided
  const derivedDuration =
    typeof run.duration === 'number'
      ? run.duration
      : rawEndTime && !isActiveStatus
        ? new Date(rawEndTime).getTime() - new Date(startTime).getTime()
        : Math.max(0, Date.now() - new Date(startTime).getTime())

  const triggerType = (run.triggerType as ExecutionTriggerType) ?? 'manual'
  const triggerLabelRaw = typeof run.triggerLabel === 'string' ? run.triggerLabel.trim() : ''

  return {
    id: String(run.id ?? ''),
    workflowId: String(run.workflowId ?? ''),
    workflowName: String(run.workflowName ?? 'Untitled workflow'),
    status,
    startTime,
    endTime: rawEndTime,
    duration: Number.isFinite(derivedDuration) ? derivedDuration : undefined,
    nodeCount: typeof run.nodeCount === 'number' ? run.nodeCount : 0,
    eventCount: typeof run.eventCount === 'number' ? run.eventCount : 0,
    createdAt: startTime,
    isLive: isActiveStatus,
    workflowVersionId: typeof run.workflowVersionId === 'string' ? run.workflowVersionId : null,
    workflowVersion: typeof run.workflowVersion === 'number' ? run.workflowVersion : null,
    triggerType,
    triggerSource: typeof run.triggerSource === 'string' ? run.triggerSource : null,
    triggerLabel: triggerLabelRaw.length > 0 ? triggerLabelRaw : TRIGGER_LABELS[triggerType],
    inputPreview:
      (run.inputPreview as ExecutionInputPreview) ?? { runtimeInputs: {}, nodeOverrides: {} },
    parentRunId: typeof run.parentRunId === 'string' ? run.parentRunId : null,
    parentNodeRef: typeof run.parentNodeRef === 'string' ? run.parentNodeRef : null,
  }
}

const sortRuns = (runs: ExecutionRun[]): ExecutionRun[] => {
  return [...runs].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  )
}

const upsertIntoRuns = (runs: ExecutionRun[], run: ExecutionRun) => {
  const existingIndex = runs.findIndex((item) => item.id === run.id)
  if (existingIndex === -1) {
    return sortRuns([...runs, run])
  }
  const updated = [...runs]
  updated[existingIndex] = {
    ...updated[existingIndex],
    ...run,
    status: run.status,
  }
  return sortRuns(updated)
}

export const useRunStore = create<RunStore>()(
  subscribeWithSelector((set, get) => ({
    ...INITIAL_STATE,

    fetchRuns: async (options) => {
      const workflowId = options?.workflowId ?? null
      
      // Skip fetching for placeholder "new" workflow ID - it's an unsaved workflow
      if (workflowId === 'new') {
        return []
      }
      
      const key = getCacheKey(workflowId)
      const force = options?.force ?? false
      const state = get()
      const entry = getEntry(state.cache, key)
      const now = Date.now()

      if (!force) {
        if (entry.isLoading && inflightFetches.has(key)) {
          return inflightFetches.get(key)
        }
        if (entry.lastFetched && now - entry.lastFetched < RUNS_STALE_MS) {
          return entry.runs
        }
        if (inflightFetches.has(key)) {
          return inflightFetches.get(key)
        }
      }

      set((state) => ({
        cache: {
          ...state.cache,
          [key]: {
            ...getEntry(state.cache, key),
            isLoading: true,
            error: null,
          },
        },
      }))

      const fetchPromise = (async () => {
        try {
          const response = await api.executions.listRuns({
            limit: 50,
            workflowId: workflowId ?? undefined,
          })
          const normalized = sortRuns((response.runs ?? []).map(normalizeRun))
          set((state) => ({
            cache: {
              ...state.cache,
              [key]: {
                runs: normalized,
                isLoading: false,
                error: null,
                lastFetched: Date.now(),
              },
            },
          }))
          return normalized
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to fetch runs'
          set((state) => ({
            cache: {
              ...state.cache,
              [key]: {
                ...getEntry(state.cache, key),
                isLoading: false,
                error: message,
              },
            },
          }))
          throw error
        } finally {
          inflightFetches.delete(key)
        }
      })()

      inflightFetches.set(key, fetchPromise)

      try {
        return await fetchPromise
      } catch (error) {
        throw error
      }
    },

    refreshRuns: (workflowId) => get().fetchRuns({ workflowId, force: true }),

    invalidate: (workflowId) => {
      if (typeof workflowId === 'undefined') {
        set((state) => {
          const next: RunStoreState['cache'] = {}
          for (const [key, entry] of Object.entries(state.cache)) {
            next[key] = {
              ...entry,
              lastFetched: null,
              error: null,
            }
          }
          return { cache: next }
        })
        return
      }

      const key = getCacheKey(workflowId)
      set((state) => ({
        cache: {
          ...state.cache,
          [key]: {
            ...getEntry(state.cache, key),
            lastFetched: null,
            error: null,
          },
        },
      }))
    },

    upsertRun: (run: ExecutionRun) => {
      set((state) => {
        const cache = { ...state.cache }
        const workflowKey = getCacheKey(run.workflowId)
        const workflowEntry = getEntry(cache, workflowKey)

        cache[workflowKey] = {
          ...workflowEntry,
          runs: upsertIntoRuns(workflowEntry.runs, run),
        }

        if (cache[GLOBAL_WORKFLOW_CACHE_KEY]) {
          const globalEntry = getEntry(cache, GLOBAL_WORKFLOW_CACHE_KEY)
          cache[GLOBAL_WORKFLOW_CACHE_KEY] = {
            ...globalEntry,
            runs: upsertIntoRuns(globalEntry.runs, run),
          }
        }

        return { cache }
      })
    },

    getRunById: (runId: string) => {
      const state = get()
      for (const entry of Object.values(state.cache)) {
        const found = entry.runs.find((run) => run.id === runId)
        if (found) {
          return found
        }
      }
      return undefined
    },

    getLatestRun: (workflowId) => {
      const key = getCacheKey(workflowId)
      const runs = get().cache[key]?.runs ?? []
      return runs[0]
    },

    getRunsForWorkflow: (workflowId) => {
      const key = getCacheKey(workflowId)
      return get().cache[key]?.runs ?? []
    },
  }))
)

export const resetRunStoreState = () => {
  inflightFetches.clear()
  useRunStore.setState({ ...INITIAL_STATE })
}
