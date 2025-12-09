import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'] as const
import { api } from '@/services/api'
import type { ExecutionLog, ExecutionStatusResponse } from '@/schemas/execution'
import type { NodeStatus } from '@/schemas/node'

// Types for the visual timeline system
export interface TimelineEvent extends ExecutionLog {
  visualTime: number // Normalized time for playback (0-1)
  duration?: number // Event duration in ms
  offsetMs: number // Milliseconds from first event timestamp
}

export interface NodeVisualState {
  status: NodeStatus
  progress: number // 0-100
  startTime: number
  endTime?: number
  eventCount: number
  totalEvents: number
  lastEvent: TimelineEvent | null
  dataFlow: {
    input: DataPacket[]
    output: DataPacket[]
  }
  lastMetadata?: TimelineEvent['metadata']
  lastActivityId?: string
  attempts: number
  retryCount: number
}

export interface DataPacket {
  id: string
  sourceNode: string
  targetNode: string
  inputKey?: string
  payload: any
  timestamp: number
  size: number // bytes
  type: 'file' | 'json' | 'text' | 'binary'
  visualTime: number // When this packet should appear in timeline
}

type RawDataPacket = {
  id: string
  sourceNode: string
  targetNode: string
  timestamp: string
  inputKey?: string
  payload?: any
  size?: number
  type?: string
  visualTime?: number
}

export interface AgentTimelineMarker {
  id: string
  nodeId: string
  label: string
  timestamp: string
}

export interface TimelineState {
  // Run selection
  selectedRunId: string | null

  // Timeline state
  events: TimelineEvent[]
  dataFlows: DataPacket[]
  totalDuration: number // presentation duration used by the UI (may include clock interpolation)
  eventDuration: number // duration derived purely from ingested events (authoritative data)
  timelineStartTime: number | null
  clockOffset: number | null // Clock offset: serverTime - clientTime (calculated once, reused)
  currentTime: number // Current position in timeline (ms)
  playbackMode: 'live' | 'replay'

  // Playback controls
  isPlaying: boolean
  playbackSpeed: number // 0.1, 0.5, 1, 2, 5, 10
  isSeeking: boolean

  // Node states for visualization
  nodeStates: Record<string, NodeVisualState>
  selectedNodeId: string | null
  selectedEventId: string | null

  // UI state
  showTimeline: boolean
  showEventInspector: boolean
  timelineZoom: number // 1.0 - 100.0
  isLiveFollowing: boolean
  agentMarkersRunId: string | null
  agentMarkers: Record<string, AgentTimelineMarker[]>
}

export interface TimelineActions {
  // Run management
  selectRun: (runId: string, initialMode?: 'live' | 'replay') => Promise<void>

  // Timeline loading
  loadTimeline: (runId: string) => Promise<void>

  // Playback controls
  play: () => void
  pause: () => void
  seek: (timeMs: number) => void
  setPlaybackSpeed: (speed: number) => void
  stepForward: () => void
  stepBackward: () => void

  // Node interaction
  selectNode: (nodeId: string | null) => void
  selectEvent: (eventId: string | null) => void

  // UI controls
  toggleTimeline: () => void
  toggleEventInspector: () => void
  setTimelineZoom: (zoom: number) => void

  // Live updates
  updateFromLiveEvent: (event: ExecutionLog) => void
  switchToLiveMode: () => void
  appendDataFlows: (packets: RawDataPacket[]) => void

  goLive: () => void
  tickLiveClock: () => void

  setAgentMarkers: (runId: string, nodeId: string, markers: AgentTimelineMarker[]) => void

  // Cleanup
  reset: () => void
}

export type TimelineStore = TimelineState & TimelineActions

const PLAYBACK_SPEEDS = [0.1, 0.5, 1, 2, 5, 10]

const MIN_TIMELINE_DURATION_MS = 1

const prepareTimelineEvents = (
  rawEvents: ExecutionLog[],
  workflowStartTime?: number | null
): {
  events: TimelineEvent[]
  totalDuration: number
  timelineStartTime: number | null
} => {
  if (!rawEvents || rawEvents.length === 0) {
    return {
      events: [],
      totalDuration: 0,
      timelineStartTime: workflowStartTime ?? null,
    }
  }

  const sortedEvents = [...rawEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  if (sortedEvents.length === 0) {
    return {
      events: [],
      totalDuration: 0,
      timelineStartTime: workflowStartTime ?? 0,
    }
  }

  // Use workflow start time if provided, otherwise use first event timestamp
  // Always prefer workflowStartTime when available (it's the authoritative source)
  const firstEventTime = new Date(sortedEvents[0].timestamp).getTime()
  const startTime = workflowStartTime !== null && workflowStartTime !== undefined
    ? workflowStartTime
    : firstEventTime
  const endTime = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime()
  const totalDuration = Math.max(endTime - startTime, MIN_TIMELINE_DURATION_MS)

  const events: TimelineEvent[] = sortedEvents.map((event, index) => {
    const eventTime = new Date(event.timestamp).getTime()
    const offsetMs = eventTime - startTime
    
    // Calculate duration based on next event or a default duration
    let duration = 0
    if (index < sortedEvents.length - 1) {
      const nextEventTime = new Date(sortedEvents[index + 1].timestamp).getTime()
      duration = Math.max(nextEventTime - eventTime, 100) // Minimum 100ms duration
    } else {
      duration = Math.max(totalDuration - offsetMs, 100) // For last event, use remaining time
    }

    return {
      ...event,
      visualTime: totalDuration > 0 ? offsetMs / totalDuration : 0,
      duration,
      offsetMs,
    }
  })

  return {
    events,
    totalDuration,
    timelineStartTime: startTime,
  }
}

const normalizeDataPackets = (
  rawPackets: RawDataPacket[] = [],
  timelineStartTime: number | null,
  totalDuration: number
): DataPacket[] => {
  if (!rawPackets.length) {
    return []
  }

  return rawPackets
    .filter((packet): packet is RawDataPacket & { id: string; sourceNode: string; targetNode: string; timestamp: string } => {
      return Boolean(packet.id && packet.sourceNode && packet.targetNode && packet.timestamp)
    })
    .map((packet) => {
      const packetTimestamp = new Date(packet.timestamp).getTime()
      const baseStart = timelineStartTime ?? packetTimestamp
      const computedTotal = totalDuration > 0 ? totalDuration : Math.max(packetTimestamp - baseStart, 1)

      const visualTime =
        typeof packet.visualTime === 'number'
          ? packet.visualTime
          : computedTotal > 0
            ? Math.max(0, Math.min(1, (packetTimestamp - baseStart) / computedTotal))
            : 0

      return {
        id: packet.id,
        sourceNode: packet.sourceNode,
        targetNode: packet.targetNode,
        inputKey: packet.inputKey,
        payload: packet.payload,
        timestamp: packetTimestamp,
        size: typeof packet.size === 'number' ? packet.size : Number(packet.size ?? 0),
        type: (packet.type as DataPacket['type']) ?? 'json',
        visualTime,
      }
    })
}

const calculateNodeStates = (
  events: TimelineEvent[],
  dataFlows: DataPacket[],
  currentTime: number,
  timelineStartTime?: number | null
): Record<string, NodeVisualState> => {
  const states: Record<string, NodeVisualState> = {}

  if (events.length === 0) {
    return states
  }

  const firstEventTimestamp = new Date(events[0].timestamp).getTime()
  const startTime = timelineStartTime ?? firstEventTimestamp
  const absoluteCurrentTime = startTime + currentTime
  const filteredPackets = dataFlows.filter((packet) => {
    const packetTime = new Date(packet.timestamp).getTime()
    return packetTime <= absoluteCurrentTime
  })

  const inputPacketsByNode = new Map<string, DataPacket[]>()
  const outputPacketsByNode = new Map<string, DataPacket[]>()

  filteredPackets.forEach((packet) => {
    if (!inputPacketsByNode.has(packet.targetNode)) {
      inputPacketsByNode.set(packet.targetNode, [])
    }
    inputPacketsByNode.get(packet.targetNode)!.push(packet)

    if (!outputPacketsByNode.has(packet.sourceNode)) {
      outputPacketsByNode.set(packet.sourceNode, [])
    }
    outputPacketsByNode.get(packet.sourceNode)!.push(packet)
  })

  // Group events by node
  const nodeEvents = new Map<string, TimelineEvent[]>()
  events.forEach(event => {
    if (event.nodeId) {
      if (!nodeEvents.has(event.nodeId)) {
        nodeEvents.set(event.nodeId, [])
      }
      nodeEvents.get(event.nodeId)!.push(event)
    }
  })

  // Calculate state for each node
  nodeEvents.forEach((nodeEventList, nodeId) => {
    const sortedEvents = [...nodeEventList].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    const relevantEvents = sortedEvents.filter(event =>
      new Date(event.timestamp).getTime() <= absoluteCurrentTime
    )

    if (relevantEvents.length === 0) {
      states[nodeId] = {
        status: 'idle',
        progress: 0,
        startTime: new Date(sortedEvents[0].timestamp).getTime(),
        eventCount: 0,
        totalEvents: sortedEvents.length,
        lastEvent: null,
        dataFlow: { input: [], output: [] },
        lastMetadata: undefined,
        lastActivityId: undefined,
        attempts: 0,
        retryCount: 0,
      }
      return
    }

    const lastEvent = relevantEvents[relevantEvents.length - 1]
    const firstNodeEventTimestamp = new Date(sortedEvents[0].timestamp).getTime()
    const lastEventTimestamp = new Date(lastEvent.timestamp).getTime()
    let highestAttempt = 0
    let latestMetadata: TimelineEvent['metadata'] | undefined
    let lastActivityId: string | undefined

    relevantEvents.forEach((event) => {
      const attempt = typeof event.metadata?.attempt === 'number' ? event.metadata.attempt : null
      if (attempt && attempt > highestAttempt) {
        highestAttempt = attempt
      }
      if (event.metadata) {
        latestMetadata = event.metadata
        if (typeof event.metadata.activityId === 'string') {
          lastActivityId = event.metadata.activityId
        }
      }
    })

    const attempts = highestAttempt || (typeof lastEvent.metadata?.attempt === 'number' ? lastEvent.metadata.attempt : relevantEvents.length > 0 ? 1 : 0)
    const retryCount = attempts > 0 ? Math.max(0, attempts - 1) : 0

    // Determine status based on last event
    let status: NodeStatus = 'idle'
    switch (lastEvent.type) {
      case 'STARTED':
        status = 'running'
        break
      case 'PROGRESS':
        status = 'running'
        break
      case 'COMPLETED':
        status = 'success'
        break
      case 'FAILED':
        status = 'error'
        break
    }

    // Calculate progress based on events observed vs total events
    // Always show progress based on event counts, not just when PROGRESS events exist
    const completedEvents = relevantEvents.filter(e => e.type === 'COMPLETED')
    const hasCompleted = completedEvents.length > 0
    
    // Calculate progress: if completed, show 100%, otherwise show percentage based on events
    // Use relevantEvents.length and sortedEvents.length for accurate progress calculation
    let progress = 0
    if (hasCompleted) {
      progress = 100
    } else if (sortedEvents.length > 0) {
      // Calculate percentage: events observed / total events
      const eventRatio = relevantEvents.length / sortedEvents.length
      progress = Math.min(100, Math.max(0, eventRatio * 100))
    } else {
      progress = 0
    }

    states[nodeId] = {
      status,
      progress,
      startTime: firstNodeEventTimestamp,
      endTime: status === 'success' || status === 'error' ? lastEventTimestamp : undefined,
      eventCount: relevantEvents.length,
      totalEvents: sortedEvents.length,
      lastEvent,
      dataFlow: {
        input: inputPacketsByNode.get(nodeId) ?? [],
        output: outputPacketsByNode.get(nodeId) ?? [],
      },
      lastMetadata: latestMetadata ?? lastEvent.metadata,
      lastActivityId,
      attempts,
      retryCount,
    }
  })

  // Ensure nodes that only appear in data flow packets are represented
  filteredPackets.forEach((packet) => {
    if (!states[packet.sourceNode]) {
      states[packet.sourceNode] = {
        status: 'idle',
        progress: 0,
        startTime: new Date(packet.timestamp).getTime(),
        eventCount: 0,
        totalEvents: 0,
        lastEvent: null,
        dataFlow: {
          input: inputPacketsByNode.get(packet.sourceNode) ?? [],
          output: outputPacketsByNode.get(packet.sourceNode) ?? [],
        },
        lastMetadata: undefined,
        lastActivityId: undefined,
        attempts: 0,
        retryCount: 0,
      }
    }
    if (!states[packet.targetNode]) {
      states[packet.targetNode] = {
        status: 'idle',
        progress: 0,
        startTime: new Date(packet.timestamp).getTime(),
        eventCount: 0,
        totalEvents: 0,
        lastEvent: null,
        dataFlow: {
          input: inputPacketsByNode.get(packet.targetNode) ?? [],
          output: outputPacketsByNode.get(packet.targetNode) ?? [],
        },
        lastMetadata: undefined,
        lastActivityId: undefined,
        attempts: 0,
        retryCount: 0,
      }
    }
  })

  return states
}

const INITIAL_STATE: TimelineState = {
  selectedRunId: null,
  events: [],
  dataFlows: [],
  totalDuration: 0,
  eventDuration: 0,
  timelineStartTime: null,
  clockOffset: null,
  currentTime: 0,
  playbackMode: 'replay',
  isPlaying: false,
  playbackSpeed: 1,
  isSeeking: false,
  nodeStates: {},
  selectedNodeId: null,
  selectedEventId: null,
  showTimeline: true,
  showEventInspector: false,
  timelineZoom: 1,
  isLiveFollowing: false,
  agentMarkersRunId: null,
  agentMarkers: {},
}

export const useExecutionTimelineStore = create<TimelineStore>()(
  subscribeWithSelector((set, get) => ({
    ...INITIAL_STATE,

    selectRun: async (runId: string, initialMode: 'live' | 'replay' = 'replay') => {
      // Clear previous events before loading new timeline
      set({ 
        selectedRunId: runId,
        events: [],
        dataFlows: [],
        totalDuration: 0,
        eventDuration: 0,
        currentTime: 0,
        timelineStartTime: null,
        clockOffset: null,
        nodeStates: {},
        playbackMode: initialMode,
        isPlaying: false,
        isLiveFollowing: initialMode === 'live',
        agentMarkersRunId: null,
        agentMarkers: {},
      })
      await get().loadTimeline(runId)
    },

    loadTimeline: async (runId: string) => {
      try {
        const [eventsResponse, dataFlowResponse, statusResponse] = await Promise.all([
          api.executions.getEvents(runId),
          api.executions.getDataFlows(runId),
          api.executions.getStatus(runId).catch(() => null)
        ])

        // Also fetch historical logs for the run
        void import('./executionStore').then(({ useExecutionStore }) => {
          useExecutionStore.getState().fetchHistoricalLogs(runId)
        })

        const eventsList = (eventsResponse.events ?? []).filter(
          (event): event is ExecutionLog => 
            Boolean(event.id && event.runId && event.nodeId && event.timestamp && event.type && event.level)
        )
        
        // Use run start time if available, otherwise fallback to first event
        const status = statusResponse as ExecutionStatusResponse | null
        const parsedStartTime = status?.startedAt ? new Date(status.startedAt).getTime() : NaN
        const workflowStartTime = !isNaN(parsedStartTime) ? parsedStartTime : null
          
        const { events, totalDuration: eventDuration, timelineStartTime } = prepareTimelineEvents(eventsList, workflowStartTime)
        const packetsList = (dataFlowResponse.packets ?? []).map(packet => {
          let timestamp: string
          if (typeof packet.timestamp === 'number') {
            timestamp = new Date(packet.timestamp).toISOString()
          } else if (typeof packet.timestamp === 'string') {
            timestamp = packet.timestamp
          } else {
            timestamp = new Date().toISOString()
          }
          return {
            id: packet.id ?? '',
            sourceNode: packet.sourceNode ?? '',
            targetNode: packet.targetNode ?? '',
            timestamp,
            inputKey: packet.inputKey ?? undefined,
            payload: packet.payload ?? undefined,
            size: packet.size,
            type: packet.type,
            visualTime: packet.visualTime,
          }
        })
        const dataFlows = normalizeDataPackets(
          packetsList,
          timelineStartTime,
          eventDuration,
        )

        const state = get()
        const isLiveMode = state.playbackMode === 'live'
        const hadTimeline = state.events.length > 0
        // In replay mode we want the transcript/timeline to start at the end for fresh loads
        // so the full run is visible. When the user has already been scrubbing (events exist)
        // we preserve their current position. Live mode keeps its current behaviour.
        const initialCurrentTime = isLiveMode
          ? (state.isLiveFollowing ? eventDuration : Math.min(state.currentTime, eventDuration))
          : (hadTimeline ? Math.min(state.currentTime, eventDuration) : eventDuration)

        set({
          events,
          dataFlows,
          eventDuration,
          totalDuration: eventDuration,
          currentTime: initialCurrentTime,
          timelineStartTime,
          clockOffset: null,
          nodeStates: calculateNodeStates(events, dataFlows, initialCurrentTime, timelineStartTime)
        })
      } catch (error) {
        console.error('Failed to load timeline:', error)
      }
    },

    play: () => {
      if (get().playbackMode === 'live') return

      set({ isPlaying: true })
    },

    pause: () => {
      set({ isPlaying: false })
    },

    seek: (timeMs: number) => {
      const state = get()
      const clampedTime = Math.max(0, Math.min(timeMs, state.totalDuration))
      set((prev) => ({
        currentTime: clampedTime,
        isSeeking: true,
        isLiveFollowing: prev.playbackMode === 'live' ? false : prev.isLiveFollowing,
      }))

      // Recalculate node states for new time
      const { events, dataFlows, timelineStartTime } = get()
      const newStates = calculateNodeStates(events, dataFlows, clampedTime, timelineStartTime)
      set({ nodeStates: newStates })

      // Clear seeking flag after a short delay
      setTimeout(() => set({ isSeeking: false }), 100)
    },

    setPlaybackSpeed: (speed: number) => {
      if (PLAYBACK_SPEEDS.includes(speed)) {
        set({ playbackSpeed: speed })
      }
    },

    stepForward: () => {
      const { currentTime, events, totalDuration } = get()
      if (events.length === 0) return

      const nextEvent = events.find(event => event.offsetMs > currentTime)

      if (nextEvent) {
        get().seek(nextEvent.offsetMs)
      } else {
        get().seek(totalDuration)
      }
    },

    stepBackward: () => {
      const { currentTime, events } = get()
      if (events.length === 0) return
      const previousEvent = [...events].reverse().find(event => event.offsetMs < currentTime)

      if (previousEvent) {
        get().seek(previousEvent.offsetMs)
      } else {
        get().seek(0)
      }
    },

    selectNode: (nodeId: string | null) => {
      set({ selectedNodeId: nodeId, selectedEventId: null })
    },

    selectEvent: (eventId: string | null) => {
      set({ selectedEventId: eventId })
    },

    toggleTimeline: () => {
      set(state => ({ showTimeline: !state.showTimeline }))
    },

    toggleEventInspector: () => {
      set(state => ({ showEventInspector: !state.showEventInspector }))
    },

    setTimelineZoom: (zoom: number) => {
      set({ timelineZoom: Math.max(1.0, Math.min(100.0, zoom)) })
    },

    appendDataFlows: (packets: RawDataPacket[]) => {
      if (!packets || packets.length === 0) {
        return
      }

      set((state) => {
        const derivedDuration =
          state.eventDuration > 0
            ? state.eventDuration
            : state.events.length > 0 && state.timelineStartTime !== null
              ? new Date(state.events[state.events.length - 1].timestamp).getTime() - state.timelineStartTime
              : 0

        const normalized = normalizeDataPackets(
          packets,
          state.timelineStartTime,
          derivedDuration,
        )
        const dataFlows = [...state.dataFlows, ...normalized]
        return {
          dataFlows,
          nodeStates: calculateNodeStates(state.events, dataFlows, state.currentTime, state.timelineStartTime),
        }
      })
    },

    goLive: () => {
      const state = get()
      if (!state.selectedRunId) return
      const liveBaseline = Math.max(state.totalDuration, state.eventDuration)
      set({
        playbackMode: 'live',
        isLiveFollowing: true,
        currentTime: liveBaseline,
        totalDuration: liveBaseline,
      })
    },

    tickLiveClock: () => {
      const state = get()
      if (state.playbackMode !== 'live' || !state.timelineStartTime) {
        return
      }
      const now = Date.now()
      if (liveTickTimestamp && now - liveTickTimestamp < 200) {
        return
      }
      liveTickTimestamp = now
      
      // Use clock offset to calculate server time: serverTime = clientTime + offset
      // This allows smooth clock progression without constant syncing
      let serverNow: number
      if (state.clockOffset !== null) {
        // Use calculated offset for smooth progression
        serverNow = now + state.clockOffset
      } else if (state.events.length > 0) {
        // Fallback: use last event timestamp (from server) if offset not calculated yet
        const lastEvent = state.events[state.events.length - 1]
        serverNow = new Date(lastEvent.timestamp).getTime()
      } else {
        // No server time available, use client time as fallback
        serverNow = now
      }
      
      // Treat elapsed clock time as a projection that can run slightly ahead of the last event.
      // We never let it fall behind eventDuration so markers stay aligned with real data.
      const elapsed = Math.max(0, serverNow - state.timelineStartTime)
      const projectedDuration = Math.max(elapsed, state.eventDuration)
      const shouldAdvance = state.isLiveFollowing
      const nextCurrent = shouldAdvance ? projectedDuration : state.currentTime

      if (projectedDuration === state.totalDuration && nextCurrent === state.currentTime) {
        return
      }
      set({
        totalDuration: projectedDuration,
        currentTime: nextCurrent,
      })
    },

    updateFromLiveEvent: (event: ExecutionLog) => {
      const { events, playbackMode, timelineStartTime: currentStartTime } = get()
      if (playbackMode !== 'live') return

      if (events.some(existing => existing.id === event.id)) {
        return
      }

      const combinedEvents = [...events, event]
      // Preserve existing timelineStartTime if already set correctly (from workflow start time)
      // This prevents recalculating it from first event timestamp
      const {
        events: preparedEvents,
        totalDuration,
        timelineStartTime: calculatedStartTime
      } = prepareTimelineEvents(combinedEvents, currentStartTime)

      set((state) => {
        // Use calculated start time, which will preserve currentStartTime if it was passed
        const resolvedStart = calculatedStartTime
        const nextTotal = Math.max(totalDuration, state.totalDuration)
        const shouldFollow = state.isLiveFollowing
        const nextCurrent = shouldFollow ? nextTotal : Math.min(state.currentTime, nextTotal)
        
        // Calculate clock offset if not already set (only once per run)
        // offset = serverTime - clientTime, so serverTime = clientTime + offset
        let clockOffset = state.clockOffset
        if (clockOffset === null) {
          const eventServerTime = new Date(event.timestamp).getTime()
          const clientTime = Date.now()
          clockOffset = eventServerTime - clientTime
        }
        
        const presentationCurrent = shouldFollow ? state.currentTime : nextCurrent
        return {
          events: preparedEvents,
          eventDuration: nextTotal,
          totalDuration: shouldFollow ? Math.max(state.totalDuration, nextTotal) : nextTotal,
          timelineStartTime: resolvedStart,
          clockOffset,
          currentTime: presentationCurrent,
          nodeStates: calculateNodeStates(preparedEvents, state.dataFlows, presentationCurrent, resolvedStart),
        }
      })
    },

    switchToLiveMode: () => {
      const state = get()
      if (!state.selectedRunId) return

      const liveBaseline = Math.max(state.totalDuration, state.eventDuration)
      set({
        playbackMode: 'live',
        currentTime: liveBaseline,
        totalDuration: liveBaseline,
        isPlaying: false, // Live mode doesn't need play controls
        isLiveFollowing: true,
      })

      get().loadTimeline(state.selectedRunId)
    },

    setAgentMarkers: (runId: string, nodeId: string, markers: AgentTimelineMarker[]) => {
      set((state) => {
        const sameRun = state.agentMarkersRunId === runId
        const currentMarkers = sameRun ? state.agentMarkers[nodeId] ?? [] : []
        const isEqual =
          sameRun &&
          currentMarkers.length === markers.length &&
          currentMarkers.every((marker, index) => {
            const next = markers[index]
            return (
              marker.id === next?.id &&
              marker.nodeId === next?.nodeId &&
              marker.label === next?.label &&
              marker.timestamp === next?.timestamp
            )
          })
        if (isEqual) {
          return state
        }
        const base = sameRun ? { ...state.agentMarkers } : {}
        if (markers.length > 0) {
          base[nodeId] = markers
        } else {
          delete base[nodeId]
        }
        return {
          agentMarkersRunId: runId,
          agentMarkers: base,
        }
      })
    },

    reset: () => {
      set(INITIAL_STATE)
    },
  }))
)

// Subscribe to execution store for live updates
let unsubscribeExecutionStore: (() => void) | null = null
let liveTickTimestamp: number | null = null

export const initializeTimelineStore = () => {
  if (unsubscribeExecutionStore) {
    unsubscribeExecutionStore()
    unsubscribeExecutionStore = null
  }

  void import('./executionStore')
    .then(({ useExecutionStore }) => {
      // Track previous runStatus to detect completion
      let prevRunStatus: ExecutionStatusResponse | null = null
      
      unsubscribeExecutionStore = useExecutionStore.subscribe((state) => {
        const { logs, runId, status, runStatus } = state;
        const timelineStore = useExecutionTimelineStore.getState()
        
        // Check if workflow has completed or failed
        const isTerminalStatus = runStatus && TERMINAL_STATUSES.includes(runStatus.status as any)
        const isTerminalLifecycle = status === 'completed' || status === 'failed'
        
        // Check if status changed from non-terminal to terminal (workflow just completed)
        const statusJustChanged = prevRunStatus && runStatus && 
          !TERMINAL_STATUSES.includes(prevRunStatus.status as any) && 
          TERMINAL_STATUSES.includes(runStatus.status as any)
        
        // Update prevRunStatus for next comparison
        prevRunStatus = runStatus
        
        // If workflow is done and we're in live mode, switch to replay mode
        if (timelineStore.playbackMode === 'live' && timelineStore.selectedRunId === runId) {
          if (isTerminalStatus || isTerminalLifecycle || statusJustChanged) {
            // Workflow completed/failed - switch to replay mode
            // Reload timeline to ensure all final events are loaded, then position at end
            if (!runId) return
            
            console.log('[TimelineStore] Workflow completed/failed detected, switching from live to replay mode', {
              isTerminalStatus,
              isTerminalLifecycle,
              statusJustChanged,
              runStatus: runStatus?.status,
              status,
            })
            
            // Update run in run store to mark it as completed (removes from live runs)
            if (runStatus) {
              void import('./runStore').then(({ useRunStore }) => {
                const runStore = useRunStore.getState()
                const existingRun = runStore.getRunById(runId)
                if (existingRun) {
                  // Update run with final status and endTime
                  const endTime = runStatus.completedAt || runStatus.updatedAt || new Date().toISOString()
                  runStore.upsertRun({
                    ...existingRun,
                    status: runStatus.status,
                    endTime,
                    duration: existingRun.startTime
                      ? new Date(endTime).getTime() - new Date(existingRun.startTime).getTime()
                      : existingRun.duration,
                    isLive: false, // Explicitly mark as not live
                  })
                }
              })
            }
            
            useExecutionTimelineStore.setState({
              playbackMode: 'replay',
              isLiveFollowing: false,
              isPlaying: false,
            })
            // Reload timeline to get all final events, then position at end
            useExecutionTimelineStore.getState().loadTimeline(runId).then(() => {
              const finalState = useExecutionTimelineStore.getState()
              useExecutionTimelineStore.setState({
                currentTime: finalState.totalDuration, // Position at the end, ready for replay
                nodeStates: calculateNodeStates(
                  finalState.events,
                  finalState.dataFlows,
                  finalState.totalDuration,
                  finalState.timelineStartTime
                ),
              })
              console.log('[TimelineStore] Successfully switched to replay mode at end position', {
                totalDuration: finalState.totalDuration,
                eventsCount: finalState.events.length,
              })
            })
            return
          }
          
          // Continue updating timeline with new logs
          // Use workflow start time (from runStatus) as the timeline start time if available
          // This ensures the timeline starts at 0 seconds, not when the first event arrives
          // Always prefer workflowStartTime when available - it's the authoritative source
          // This fixes the issue where timelineStartTime might have been set from first event timestamp
          // before runStatus.startedAt was available
          const workflowStartTime = runStatus?.startedAt ? new Date(runStatus.startedAt).getTime() : null
          
          const {
            events,
            totalDuration: eventDuration,
            timelineStartTime: calculatedStartTime,
          } = prepareTimelineEvents(logs, workflowStartTime)
          
          // Use workflowStartTime if available, otherwise use calculated start time (from first event)
          const finalStartTime = workflowStartTime ?? calculatedStartTime
          
          // Calculate clock offset once when we first get server time
          // This allows smooth clock progression without constant syncing
          // Only update if not already set (to avoid constant recalculation)
          let clockOffset = useExecutionTimelineStore.getState().clockOffset
          if (clockOffset === null && runStatus?.updatedAt) {
            const serverTime = new Date(runStatus.updatedAt).getTime()
            const clientTime = Date.now()
            clockOffset = serverTime - clientTime
          }

          useExecutionTimelineStore.setState((state) => {
            // Maintain two notions of time:
            // - eventDuration reflects the actual envelope of backend events
            // - totalDuration/currentTime drive the UI and are only overridden when not following live
            // Respect user's manual seek position - only update currentTime if following live
            const shouldFollow = state.isLiveFollowing
            const nextCurrentTime = shouldFollow 
              ? state.currentTime
              : Math.min(state.currentTime, eventDuration) // Don't go past end, but preserve manual position
            
            return {
              events,
              eventDuration,
              totalDuration: shouldFollow ? Math.max(state.totalDuration, eventDuration) : eventDuration,
              timelineStartTime: finalStartTime,
              clockOffset: clockOffset ?? state.clockOffset,
              currentTime: nextCurrentTime,
              nodeStates: calculateNodeStates(events, state.dataFlows, nextCurrentTime, finalStartTime),
            }
          })
        }
      })
    })
    .catch((error) => {
      console.error('Failed to initialize timeline store subscription', error)
    })
}
