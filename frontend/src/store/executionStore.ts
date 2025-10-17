import { create } from 'zustand'
import { api } from '@/services/api'
import {
  ExecutionStatusResponseSchema,
  type ExecutionLog,
  type ExecutionStatus,
  type ExecutionStatusResponse,
} from '@/schemas/execution'
import type { NodeStatus } from '@/schemas/node'

type ExecutionLifecycle =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface ExecutionStoreState {
  runId: string | null
  workflowId: string | null
  status: ExecutionLifecycle
  runStatus: ExecutionStatusResponse | null
  logs: ExecutionLog[]
  nodeStates: Record<string, NodeStatus>
  cursor: string | null
  pollingInterval: NodeJS.Timeout | null
  eventSource: EventSource | null
  streamingMode: 'realtime' | 'polling' | 'none'
}

interface ExecutionStoreActions {
  startExecution: (workflowId: string, inputs?: Record<string, unknown>) => Promise<string | undefined>
  monitorRun: (runId: string, workflowId?: string | null) => void
  pollOnce: () => Promise<void>
  stopPolling: () => void
  reset: () => void
  connectStream: (runId: string) => void
  disconnectStream: () => void
  getNodeLogs: (nodeId: string) => ExecutionLog[]
  getNodeLogCounts: (nodeId: string) => { total: number; errors: number; warnings: number }
  getLastLogMessage: (nodeId: string) => string | null
}

type ExecutionStore = ExecutionStoreState & ExecutionStoreActions

const TERMINAL_STATUSES: ExecutionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']

const mapStatusToLifecycle = (status: ExecutionStatus | undefined): ExecutionLifecycle => {
  switch (status) {
    case 'QUEUED':
      return 'queued'
    case 'RUNNING':
      return 'running'
    case 'COMPLETED':
      return 'completed'
    case 'FAILED':
      return 'failed'
    case 'CANCELLED':
      return 'cancelled'
    case 'TERMINATED':
    case 'TIMED_OUT':
      return 'failed'
    default:
      return 'idle'
  }
}

const mergeLogs = (existing: ExecutionLog[], incoming: ExecutionLog[]): ExecutionLog[] => {
  if (incoming.length === 0) return existing
  const seen = new Set(existing.map((event) => event.id))
  const deduped = incoming.filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  })
  if (deduped.length === 0) return existing
  return [...existing, ...deduped]
}

const deriveNodeStates = (events: ExecutionLog[]): Record<string, NodeStatus> => {
  const states: Record<string, NodeStatus> = {}
  for (const event of events) {
    if (!event.nodeId) continue
    switch (event.type) {
      case 'STARTED':
        states[event.nodeId] = 'running'
        break
      case 'PROGRESS':
        if (!states[event.nodeId]) {
          states[event.nodeId] = 'running'
        }
        break
      case 'COMPLETED':
        states[event.nodeId] = 'success'
        break
      case 'FAILED':
        states[event.nodeId] = 'error'
        break
      default:
        break
    }
  }
  return states
}

const INITIAL_STATE: ExecutionStoreState = {
  runId: null,
  workflowId: null,
  status: 'idle',
  runStatus: null,
  logs: [],
  nodeStates: {},
  cursor: null,
  pollingInterval: null,
  eventSource: null,
  streamingMode: 'none',
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  ...INITIAL_STATE,

  startExecution: async (workflowId: string, inputs?: Record<string, unknown>) => {
    try {
      get().reset()
      set({ status: 'queued', workflowId })

      const { executionId } = await api.executions.start(workflowId, inputs)
      if (!executionId) {
        set({ status: 'failed' })
        return undefined
      }

      set({
        runId: executionId,
        status: 'running',
        logs: [],
        nodeStates: {},
        cursor: null,
      })

      await get().pollOnce()
      get().monitorRun(executionId, workflowId)

      return executionId
    } catch (error) {
      console.error('Failed to start execution:', error)
      set({ status: 'failed' })
      throw error
    }
  },

  monitorRun: (runId: string, workflowId?: string | null) => {
    if (!runId) return

    const existingInterval = get().pollingInterval
    if (existingInterval) {
      clearInterval(existingInterval)
    }

    if (workflowId) {
      set({ workflowId })
    }

    const poll = async () => {
      await get().pollOnce()
    }

    poll()

    const interval = setInterval(poll, 2000)
    set({ pollingInterval: interval, runId })

    get().connectStream(runId)
  },

  pollOnce: async () => {
    const runId = get().runId
    if (!runId) return

    try {
      const [statusPayload, traceEnvelope] = await Promise.all([
        api.executions.getStatus(runId),
        api.executions.getTrace(runId),
      ])

      set((state) => {
        const mergedLogs = mergeLogs(state.logs, traceEnvelope.events)
        const nodeStates = deriveNodeStates(mergedLogs)
        const lifecycle = mapStatusToLifecycle(statusPayload.status)

        return {
          runStatus: statusPayload,
          status: lifecycle,
          logs: mergedLogs,
          nodeStates,
          cursor: traceEnvelope.cursor ?? state.cursor,
        }
      })

      if (TERMINAL_STATUSES.includes(statusPayload.status)) {
        get().stopPolling()
      }
    } catch (error) {
      console.error('Failed to poll execution status:', error)
    }
  },

  stopPolling: () => {
    const interval = get().pollingInterval
    if (interval) {
      clearInterval(interval)
      set({ pollingInterval: null })
    }
    get().disconnectStream()
  },

  reset: () => {
    const interval = get().pollingInterval
    if (interval) {
      clearInterval(interval)
    }
    get().disconnectStream()
    set({ ...INITIAL_STATE, streamingMode: 'none' })
  },

  connectStream: (runId: string) => {
    if (typeof EventSource === 'undefined') {
      return
    }

    const { cursor } = get()
    get().disconnectStream()

    try {
      const source = api.executions.stream(runId, cursor ? { cursor } : undefined)

      source.addEventListener('trace', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            events?: ExecutionLog[]
            cursor?: string
          }
          if (!payload.events || payload.events.length === 0) {
            return
          }

          set((state) => {
            const mergedLogs = mergeLogs(state.logs, payload.events as ExecutionLog[])
            const nodeStates = deriveNodeStates(mergedLogs)
            const nextCursor =
              payload.cursor ?? payload.events![payload.events!.length - 1]?.id ?? state.cursor

            return {
              logs: mergedLogs,
              nodeStates,
              cursor: nextCursor ?? null,
            }
          })
        } catch (error) {
          console.error('Failed to parse trace payload from stream', error)
        }
      })

      source.addEventListener('status', (event) => {
        try {
          const statusPayload = ExecutionStatusResponseSchema.parse(
            JSON.parse((event as MessageEvent).data) as unknown,
          )

          set((state) => {
            const lifecycle = mapStatusToLifecycle(statusPayload.status)
            return {
              runStatus: statusPayload,
              status: lifecycle,
              workflowId: state.workflowId ?? statusPayload.workflowId,
            }
          })

          if (TERMINAL_STATUSES.includes(statusPayload.status)) {
            get().stopPolling()
          }
        } catch (error) {
          console.error('Failed to parse status update from stream', error)
        }
      })

      source.addEventListener('dataflow', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { packets?: any[] }
          if (!payload.packets || payload.packets.length === 0) {
            return
          }
          const { useExecutionTimelineStore } = require('./executionTimelineStore')
          useExecutionTimelineStore.getState().appendDataFlows(payload.packets)
        } catch (error) {
          console.error('Failed to parse dataflow payload from stream', error)
        }
      })

      source.addEventListener('ready', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            mode: 'realtime' | 'polling'
            runId: string
            interval?: number
          }

          set({ streamingMode: payload.mode })
          console.log(`Streaming connected in ${payload.mode} mode for run ${payload.runId}`)

          // If we're in polling mode, we already have the interval set up
          // If we're in realtime mode, we can reduce polling frequency as backup
          if (payload.mode === 'realtime' && get().pollingInterval) {
            // Keep a very light poll as backup for status updates
            const existingInterval = get().pollingInterval
            if (existingInterval) {
              clearInterval(existingInterval)
            }
            const backupPoll = setInterval(async () => {
              const state = get()
              if (state.runStatus && TERMINAL_STATUSES.includes(state.runStatus.status)) {
                return
              }
              await get().pollOnce()
            }, 5000) // Every 5 seconds as backup only
            set({ pollingInterval: backupPoll })
          }
        } catch (error) {
          console.error('Failed to parse ready event from stream', error)
        }
      })

      source.addEventListener('complete', () => {
        get().stopPolling()
      })

      source.onerror = (event) => {
        console.warn('Execution stream error', event)
        source.close()
        set({ eventSource: null, streamingMode: 'none' })
      }

      set({ eventSource: source, streamingMode: 'connecting' })
    } catch (error) {
      console.error('Failed to open execution stream', error)
    }
  },

  disconnectStream: () => {
    const existing = get().eventSource
    if (existing) {
      existing.close()
    }
    set({ eventSource: null, streamingMode: 'none' })
  },

  getNodeLogs: (nodeId: string) => {
    const { logs } = get()
    return logs.filter(log => log.nodeId === nodeId)
  },

  getNodeLogCounts: (nodeId: string) => {
    const nodeLogs = get().getNodeLogs(nodeId)
    return {
      total: nodeLogs.length,
      errors: nodeLogs.filter(log => log.level === 'error').length,
      warnings: nodeLogs.filter(log => log.level === 'warn').length,
    }
  },

  getLastLogMessage: (nodeId: string) => {
    const nodeLogs = get().getNodeLogs(nodeId)
    if (nodeLogs.length === 0) return null

    const lastLog = nodeLogs[nodeLogs.length - 1]
    return lastLog.message || lastLog.error?.message || `${lastLog.type}`
  },
}))
