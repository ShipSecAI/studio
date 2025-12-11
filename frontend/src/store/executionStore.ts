import { create } from 'zustand'
import { api } from '@/services/api'
import { useRunStore } from '@/store/runStore'
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
  liveLogs: ExecutionLog[] // Logs from SSE during live execution
  scrubberLogs: ExecutionLog[] // Logs for timeline scrubbing
  logMode: 'live' | 'scrubbing' | 'historical' // Which log set to display
  nodeStates: Record<string, NodeStatus>
  cursor: string | null
  terminalCursor: string | null
  logCursor: string | null
  terminalStreams: Record<string, TerminalStreamState>
  pollingInterval: NodeJS.Timeout | null
  eventSource: EventSource | null
  streamingMode: 'realtime' | 'polling' | 'none' | 'connecting'
}

interface ExecutionStoreActions {
  startExecution: (
    workflowId: string,
    options?: {
      inputs?: Record<string, unknown>
      versionId?: string
      version?: number
    }
  ) => Promise<string | undefined>
  stopExecution: () => Promise<void>
  monitorRun: (runId: string, workflowId?: string | null) => void
  pollOnce: () => Promise<void>
  stopPolling: () => void
  reset: () => void
  connectStream: (runId: string) => void
  disconnectStream: () => void
  getNodeLogs: (nodeId: string) => ExecutionLog[]
  getNodeLogCounts: (nodeId: string) => { total: number; errors: number; warnings: number }
  getLastLogMessage: (nodeId: string) => string | null
  prefetchTerminal: (nodeId: string, stream?: 'pty' | 'stdout' | 'stderr', runIdOverride?: string | null) => Promise<void>
  getTerminalSession: (nodeId: string, stream?: 'pty' | 'stdout' | 'stderr') => TerminalStreamState | undefined
  fetchLogsForTimeRange: (startTime: Date, endTime: Date) => Promise<void>
  fetchHistoricalLogs: (runId: string) => Promise<void>
  setLogMode: (mode: 'live' | 'scrubbing' | 'historical') => void
  getDisplayLogs: () => ExecutionLog[]
}

type ExecutionStore = ExecutionStoreState & ExecutionStoreActions

type TerminalStreamChunk = {
  nodeRef: string
  stream: 'stdout' | 'stderr' | 'pty' | string
  chunkIndex: number
  payload: string
  recordedAt: string
  deltaMs?: number
};

type TerminalStreamState = {
  nodeRef: string
  stream: string
  cursor: string | null
  chunks: TerminalStreamChunk[]
  lastChunkIndex: number
};

const MAX_TERMINAL_CHUNKS = 500;

const TERMINAL_STATUSES: ExecutionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']

const terminalKey = (nodeId: string, stream: string = 'pty') => `${nodeId}:${stream}`;

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
    case 'TERMINATED':
      return 'cancelled'
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
  liveLogs: [],
  scrubberLogs: [],
  logMode: 'live',
  nodeStates: {},
  cursor: null,
  terminalCursor: null,
  logCursor: null,
  terminalStreams: {},
  pollingInterval: null,
  eventSource: null,
  streamingMode: 'none',
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  ...INITIAL_STATE,

  startExecution: async (workflowId: string, options?: {
    inputs?: Record<string, unknown>
    versionId?: string
    version?: number
  }) => {
    try {
      // Stop previous run if any, but don't reset everything to avoid full re-render
      const currentRunId = get().runId
      if (currentRunId) {
        get().stopPolling()
      }
      
      set({ 
        status: 'queued', 
        workflowId,
        // Clear only what's needed for new run, keep terminal streams if same workflow
        logs: [],
        liveLogs: [],
        scrubberLogs: [],
        logMode: 'live',
        nodeStates: {},
        cursor: null,
        terminalCursor: null,
        logCursor: null,
      })

      const { executionId } = await api.executions.start(workflowId, options)
      if (!executionId) {
        set({ status: 'failed' })
        return undefined
      }

      set({
        runId: executionId,
        status: 'running',
        // Terminal streams will be populated as new run progresses
        terminalStreams: {},
      })
      void useRunStore.getState().refreshRuns(workflowId)

      await get().pollOnce()
      get().monitorRun(executionId, workflowId)

      return executionId
    } catch (error) {
      console.error('Failed to start execution:', error)
      set({ status: 'failed' })
      throw error
    }
  },

  stopExecution: async () => {
    const runId = get().runId
    if (!runId) return

    try {
      await api.executions.cancel(runId)

      // Fetch final status before stopping polling so runStatus reflects terminal state.
      // This ensures timeline store and other consumers see the TERMINATED/CANCELLED status.
      try {
        const statusPayload = await api.executions.getStatus(runId)
        if (statusPayload) {
          const status = (statusPayload as any)?.status as ExecutionStatus | undefined
          const lifecycle = mapStatusToLifecycle(status)
          set({
            runStatus: statusPayload as ExecutionStatusResponse,
            status: lifecycle,
          })
        } else {
          set({ status: 'cancelled' })
        }
      } catch (statusError) {
        console.warn('Failed to fetch final status after stop:', statusError)
        set({ status: 'cancelled' })
      }

      get().stopPolling()

      const workflowId = get().workflowId
      if (workflowId) {
        void useRunStore.getState().refreshRuns(workflowId)
      }
    } catch (error) {
      console.error('Failed to stop execution:', error)
      // Still stop polling on cancel failure to avoid zombie polling
      get().stopPolling()
      set({ status: 'cancelled' })
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

      // Safety check: if runId changed or was cleared during await, abort
      if (get().runId !== runId) {
        return
      }

      if (!statusPayload || !traceEnvelope) {
        throw new Error('Failed to fetch execution data')
      }

      // Filter events to ensure they match ExecutionLog type (required fields)
      const rawEvents = (traceEnvelope.events || []) as any[]
      const validEvents = rawEvents.filter(
        (e): e is ExecutionLog =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.id === 'string' &&
          typeof e.runId === 'string' &&
          typeof e.nodeId === 'string' &&
          typeof e.timestamp === 'string'
      )

      set((state) => {
        // Double check inside setter to be absolutely sure
        if (state.runId !== runId) return state

        const mergedLogs = mergeLogs(state.logs, validEvents)
        const nodeStates = deriveNodeStates(mergedLogs)
        const status = (statusPayload as any)?.status as ExecutionStatus | undefined
        const lifecycle = mapStatusToLifecycle(status)

        return {
          runStatus: statusPayload as ExecutionStatusResponse,
          status: lifecycle,
          logs: mergedLogs,
          nodeStates,
          cursor: traceEnvelope.cursor ?? state.cursor,
        }
      })

      const status = (statusPayload as any)?.status as ExecutionStatus | undefined
      if (status && TERMINAL_STATUSES.includes(status)) {
        get().stopPolling()
        const currentWorkflowId = get().workflowId
        if (currentWorkflowId) {
          void useRunStore.getState().refreshRuns(currentWorkflowId)
        } else {
          void useRunStore.getState().refreshRuns(undefined)
        }
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

  connectStream: async (runId: string) => {
    if (typeof EventSource === 'undefined') {
      return
    }

    const { cursor, terminalCursor } = get()
    get().disconnectStream()

    try {
      const streamParams: Record<string, string> = {}
      if (cursor) streamParams.cursor = cursor
      if (terminalCursor) streamParams.terminalCursor = terminalCursor
      const source = await api.executions.stream(runId, Object.keys(streamParams).length ? streamParams : undefined)

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

      source.addEventListener('dataflow', async (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as { packets?: any[] }
          if (!payload.packets || payload.packets.length === 0) {
            return
          }
          const { useExecutionTimelineStore } = await import('./executionTimelineStore')
          useExecutionTimelineStore.getState().appendDataFlows(payload.packets)
        } catch (error) {
          console.error('Failed to parse dataflow payload from stream', error)
        }
      })

      source.addEventListener('terminal', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            cursor?: string | null
            chunks?: TerminalStreamChunk[]
          }
          console.debug('[ExecutionStore] terminal event received', {
            chunksCount: payload.chunks?.length,
            cursor: payload.cursor,
            payloadPreview: payload.chunks?.slice(0, 2),
          })

          if (!payload.chunks || payload.chunks.length === 0) {
            console.debug('[ExecutionStore] empty terminal payload, skipping')
            return
          }

          console.debug('[ExecutionStore] processing terminal chunks', {
            totalChunks: payload.chunks.length,
            firstChunk: {
              nodeRef: payload.chunks[0]?.nodeRef,
              stream: payload.chunks[0]?.stream,
              chunkIndex: payload.chunks[0]?.chunkIndex,
              payloadLength: payload.chunks[0]?.payload?.length,
            }
          })

          set((state) => {
            const streams = { ...state.terminalStreams }
            let processedChunks = 0

            for (const chunk of payload.chunks!) {
              const key = terminalKey(chunk.nodeRef, chunk.stream)
              const existing = streams[key] ?? {
                nodeRef: chunk.nodeRef,
                stream: chunk.stream,
                cursor: null,
                chunks: [],
                lastChunkIndex: 0,
              }
              if (chunk.chunkIndex <= existing.lastChunkIndex) {
                console.debug('[ExecutionStore] skipping duplicate chunk', {
                  nodeRef: chunk.nodeRef,
                  stream: chunk.stream,
                  chunkIndex: chunk.chunkIndex,
                  existingIndex: existing.lastChunkIndex,
                })
                continue
              }

              console.debug('[ExecutionStore] adding new chunk', {
                nodeRef: chunk.nodeRef,
                stream: chunk.stream,
                chunkIndex: chunk.chunkIndex,
                payloadPreview: chunk.payload?.substring(0, 100),
              })

              processedChunks++
              const merged = [...existing.chunks, chunk]
              const trimmed = merged.length > MAX_TERMINAL_CHUNKS ? merged.slice(-MAX_TERMINAL_CHUNKS) : merged
              streams[key] = {
                ...existing,
                chunks: trimmed,
                lastChunkIndex: chunk.chunkIndex,
              }
            }

            console.debug('[ExecutionStore] terminal chunks processed', {
              processedChunks,
              totalStreams: Object.keys(streams).length,
              streamKeys: Object.keys(streams),
            })

            return {
              terminalStreams: streams,
              terminalCursor: payload.cursor ?? state.terminalCursor,
            }
          })
        } catch (error) {
          console.error('Failed to parse terminal payload from stream', error, (event as MessageEvent).data)
        }
      })

      source.addEventListener('logs', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            logs?: Array<{
              id: string;
              runId: string;
              nodeId: string;
              level: string;
              message: string;
              timestamp: string;
            }>;
            cursor?: string;
          }

          if (!payload.logs || payload.logs.length === 0) {
            return
          }

          set((state) => {
            // Transform logs to ExecutionLog format
            const newLogs: ExecutionLog[] = payload.logs!.map((log) => ({
              id: log.id,
              runId: log.runId,
              nodeId: log.nodeId,
              type: 'PROGRESS' as const,
              level: log.level as any,
              timestamp: log.timestamp,
              message: log.message,
            }));

            // Merge with existing live logs
            const mergedLogs = mergeLogs(state.liveLogs, newLogs);

            return {
              liveLogs: mergedLogs,
              logCursor: payload.cursor ?? state.logCursor,
            };
          });
        } catch (error) {
          console.error('Failed to parse logs payload from stream', error, (event as MessageEvent).data);
        }
      });

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

  prefetchTerminal: async (nodeId: string, stream: 'pty' | 'stdout' | 'stderr' = 'pty', runIdOverride?: string | null) => {
    const runId = runIdOverride ?? get().runId
    if (!runId) return
    const key = terminalKey(nodeId, stream)
    if (get().terminalStreams[key]?.chunks.length) {
      return
    }
    try {
      const result = await api.executions.getTerminalChunks(runId, { nodeRef: nodeId, stream })
      if (!result?.chunks || result.chunks.length === 0) {
        return
      }
      set((state) => {
        const streams = { ...state.terminalStreams }
        for (const chunk of result.chunks!) {
          const chunkKey = terminalKey(chunk.nodeRef, chunk.stream)
          const existing = streams[chunkKey] ?? {
            nodeRef: chunk.nodeRef,
            stream: chunk.stream,
            cursor: null,
            chunks: [],
            lastChunkIndex: 0,
          }
          if (chunk.chunkIndex <= existing.lastChunkIndex) {
            continue
          }
          const merged = [...existing.chunks, chunk]
          const trimmed = merged.length > MAX_TERMINAL_CHUNKS ? merged.slice(-MAX_TERMINAL_CHUNKS) : merged
          streams[chunkKey] = {
            ...existing,
            chunks: trimmed,
            lastChunkIndex: chunk.chunkIndex,
            cursor: result.cursor ?? existing.cursor ?? null,
          }
        }
        return {
          terminalStreams: streams,
          terminalCursor: result.cursor ?? state.terminalCursor,
        }
      })
    } catch (error) {
      console.error('Failed to fetch terminal chunks', error)
    }
  },

  getTerminalSession: (nodeId: string, stream: 'pty' | 'stdout' | 'stderr' = 'pty') => {
    const key = terminalKey(nodeId, stream)
    return get().terminalStreams[key]
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

  fetchLogsForTimeRange: async (startTime: Date, endTime: Date) => {
    const runId = get().runId
    if (!runId) return

    try {
      const result = await api.executions.getLogs(runId, {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        limit: 200, // More logs for timeline scrubbing
      })

      set(() => ({
        scrubberLogs: result.logs as ExecutionLog[],
        logMode: 'scrubbing',
      }))
    } catch (error) {
      console.error('Failed to fetch logs for time range', error)
    }
  },

  fetchHistoricalLogs: async (runId: string) => {
    try {
      const result = await api.executions.getLogs(runId, {
        limit: 500, // Fetch up to 500 logs for historical view
      })

      set(() => ({
        logs: result.logs as ExecutionLog[],
        logMode: 'historical',
      }))
    } catch (error) {
      console.error('Failed to fetch historical logs', error)
    }
  },

  setLogMode: (mode: 'live' | 'scrubbing' | 'historical') => {
    set({ logMode: mode })
  },

  getDisplayLogs: () => {
    const state = get()
    switch (state.logMode) {
      case 'live':
        return state.liveLogs
      case 'scrubbing':
        return state.scrubberLogs
      case 'historical':
        return state.logs
      default:
        return state.liveLogs
    }
  },
}))

// Initialize timeline scrubbing subscription
let timelineUnsubscribe: (() => void) | null = null

export const initializeExecutionStore = () => {
  if (timelineUnsubscribe) {
    timelineUnsubscribe()
    timelineUnsubscribe = null
  }

  void import('./executionTimelineStore')
    .then(({ useExecutionTimelineStore }) => {
      timelineUnsubscribe = useExecutionTimelineStore.subscribe(
        (state) => ({ currentTime: state.currentTime, playbackMode: state.playbackMode, selectedRunId: state.selectedRunId }),
        ({ currentTime, playbackMode, selectedRunId }) => {
          // Only fetch logs when scrubbing in replay mode
          if (playbackMode === 'replay' && selectedRunId) {
            const executionStore = useExecutionStore.getState()
            if (executionStore.logMode === 'scrubbing' && executionStore.runId === selectedRunId) {
              // Calculate time range for scrubbing (current time +/- some buffer)
              const bufferMs = 5000 // 5 seconds buffer
              const startTime = new Date(currentTime - bufferMs)
              const endTime = new Date(currentTime + bufferMs)

              void executionStore.fetchLogsForTimeRange(startTime, endTime)
            }
          }
        }
      )
    })
    .catch((error) => {
      console.error('Failed to initialize execution store timeline subscription', error)
    })
}
