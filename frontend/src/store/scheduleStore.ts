import { create } from 'zustand'
import type { ScheduleStatus, WorkflowSchedule } from '@shipsec/shared'
import { api } from '@/services/api'

type StatusFilter = ScheduleStatus | 'all'

interface ScheduleFilters {
  workflowId: string | null
  status: StatusFilter
  search: string
}

interface ScheduleStoreState {
  schedules: WorkflowSchedule[]
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  filters: ScheduleFilters
}

interface ScheduleStoreActions {
  fetchSchedules: (options?: { force?: boolean }) => Promise<WorkflowSchedule[]>
  refreshSchedules: () => Promise<WorkflowSchedule[]>
  setFilters: (filters: Partial<ScheduleFilters>) => void
  pauseSchedule: (id: string) => Promise<WorkflowSchedule>
  resumeSchedule: (id: string) => Promise<WorkflowSchedule>
  runSchedule: (id: string) => Promise<void>
  deleteSchedule: (id: string) => Promise<void>
  upsertSchedule: (schedule: WorkflowSchedule) => void
  removeSchedule: (id: string) => void
  setError: (message: string | null) => void
}

export type ScheduleStore = ScheduleStoreState & ScheduleStoreActions

const STALE_MS = 15_000

const INITIAL_FILTERS: ScheduleFilters = {
  workflowId: null,
  status: 'all',
  search: '',
}

const createInitialState = (): ScheduleStoreState => ({
  schedules: [],
  isLoading: false,
  error: null,
  lastFetched: null,
  filters: { ...INITIAL_FILTERS },
})

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  ...createInitialState(),

  fetchSchedules: async (options) => {
    const { lastFetched, isLoading, filters } = get()
    const force = options?.force ?? false
    const isFresh = lastFetched && Date.now() - lastFetched < STALE_MS

    if (!force && !isLoading && isFresh) {
      return get().schedules
    }

    if (!isLoading) {
      set({ isLoading: true, error: null })
    }

    try {
      const schedules = await api.schedules.list({
        workflowId: filters.workflowId ?? undefined,
        status: filters.status !== 'all' ? (filters.status as ScheduleStatus) : undefined,
      })
      set({
        schedules,
        isLoading: false,
        error: null,
        lastFetched: Date.now(),
      })
      return schedules
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch schedules'
      set({ isLoading: false, error: message })
      throw error
    }
  },

  refreshSchedules: () => get().fetchSchedules({ force: true }),

  setFilters: (partial) => {
    set((state) => ({
      filters: {
        ...state.filters,
        ...partial,
      },
    }))
  },

  pauseSchedule: async (id: string) => {
    const schedule = await api.schedules.pause(id)
    set((state) => ({
      schedules: state.schedules.map((existing) =>
        existing.id === id ? schedule : existing,
      ),
    }))
    return schedule
  },

  resumeSchedule: async (id: string) => {
    const schedule = await api.schedules.resume(id)
    set((state) => ({
      schedules: state.schedules.map((existing) =>
        existing.id === id ? schedule : existing,
      ),
    }))
    return schedule
  },

  runSchedule: async (id: string) => {
    await api.schedules.runNow(id)
  },

  deleteSchedule: async (id: string) => {
    await api.schedules.delete(id)
    set((state) => ({
      schedules: state.schedules.filter((schedule) => schedule.id !== id),
    }))
  },

  upsertSchedule: (schedule) => {
    set((state) => {
      const exists = state.schedules.some((item) => item.id === schedule.id)
      if (!exists) {
        return { schedules: [...state.schedules, schedule] }
      }
      return {
        schedules: state.schedules.map((item) =>
          item.id === schedule.id ? schedule : item,
        ),
      }
    })
  },

  removeSchedule: (id: string) => {
    set((state) => ({
      schedules: state.schedules.filter((schedule) => schedule.id !== id),
    }))
  },

  setError: (message) => {
    set({ error: message })
  },
}))

export const resetScheduleStoreState = () => {
  useScheduleStore.setState({ ...createInitialState() })
}
