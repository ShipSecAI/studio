import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { api } from '@/services/api'
import type { ExecutionLog, ExecutionStatus } from '@/schemas/execution'
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

export interface ExecutionRun {
  id: string
  workflowId: string
  workflowName: string
  status: ExecutionStatus
  startTime: string
  endTime?: string
  duration?: number // in ms
  nodeCount: number
  eventCount: number
  createdAt: string
  isLive: boolean
}

export interface TimelineState {
  // Run selection
  availableRuns: ExecutionRun[]
  selectedRunId: string | null

  // Timeline state
  events: TimelineEvent[]
  dataFlows: DataPacket[]
  totalDuration: number // in ms
  timelineStartTime: number | null
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
  timelineZoom: number // 0.5 - 2.0
}

export interface TimelineActions {
  // Run management
  loadRuns: () => Promise<void>
  selectRun: (runId: string) => Promise<void>

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
  selectNode: (nodeId: string) => void
  selectEvent: (eventId: string | null) => void

  // UI controls
  toggleTimeline: () => void
  toggleEventInspector: () => void
  setTimelineZoom: (zoom: number) => void

  // Live updates
  updateFromLiveEvent: (event: ExecutionLog) => void
  switchToLiveMode: () => void
  appendDataFlows: (packets: RawDataPacket[]) => void

  // Cleanup
  reset: () => void
}

export type TimelineStore = TimelineState & TimelineActions

const PLAYBACK_SPEEDS = [0.1, 0.5, 1, 2, 5, 10]

const prepareTimelineEvents = (
  rawEvents: ExecutionLog[]
): {
  events: TimelineEvent[]
  totalDuration: number
  timelineStartTime: number | null
} => {
  if (!rawEvents || rawEvents.length === 0) {
    return {
      events: [],
      totalDuration: 0,
      timelineStartTime: null,
    }
  }

  const sortedEvents = [...rawEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  const startTime = new Date(sortedEvents[0].timestamp).getTime()
  const endTime = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime()
  const totalDuration = Math.max(endTime - startTime, 0)

  const events: TimelineEvent[] = sortedEvents.map(event => {
    const eventTime = new Date(event.timestamp).getTime()
    const offsetMs = eventTime - startTime

    return {
      ...event,
      visualTime: totalDuration > 0 ? offsetMs / totalDuration : 0,
      duration: 0,
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

  return rawPackets.map((packet) => {
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

    // Calculate progress (simplified)
    const progressEvents = sortedEvents.filter(e => e.type === 'PROGRESS')
    const completedEvents = relevantEvents.filter(e => e.type === 'COMPLETED')
    const progress = completedEvents.length > 0 ? 100 :
      progressEvents.length > 0 ? (relevantEvents.length / sortedEvents.length) * 100 : 0

    states[nodeId] = {
      status,
      progress,
      startTime: firstNodeEventTimestamp,
      endTime: status === 'success' || status === 'error' ? lastEventTimestamp : undefined,
      eventCount: relevantEvents.length,
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
  availableRuns: [],
  selectedRunId: null,
  events: [],
  dataFlows: [],
  totalDuration: 0,
  timelineStartTime: null,
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
}

export const useExecutionTimelineStore = create<TimelineStore>()(
  subscribeWithSelector((set, get) => ({
    ...INITIAL_STATE,

    loadRuns: async () => {
      try {
        const response = await api.executions.listRuns({ limit: 50 })

        const runs: ExecutionRun[] = response.runs.map((run: any) => ({
          id: run.id,
          workflowId: run.workflowId,
          workflowName: run.workflowName,
          status: run.status.toLowerCase() as ExecutionStatus,
          startTime: run.startTime,
          endTime: run.endTime,
          duration: typeof run.duration === 'number'
            ? run.duration
            : run.endTime
              ? new Date(run.endTime).getTime() - new Date(run.startTime).getTime()
              : Date.now() - new Date(run.startTime).getTime(),
          nodeCount: typeof run.nodeCount === 'number' ? run.nodeCount : 0,
          eventCount: run.eventCount,
          createdAt: run.startTime,
          isLive: !run.endTime && run.status === 'RUNNING'
        }))

        set({ availableRuns: runs })
      } catch (error) {
        console.error('Failed to load runs:', error)
      }
    },

    selectRun: async (runId: string) => {
      set({ selectedRunId: runId })
      await get().loadTimeline(runId)
    },

    loadTimeline: async (runId: string) => {
      try {
        const [eventsResponse, dataFlowResponse] = await Promise.all([
          api.executions.getEvents(runId),
          api.executions.getDataFlows(runId)
        ])

        const { events, totalDuration, timelineStartTime } = prepareTimelineEvents(eventsResponse.events)
        const dataFlows = normalizeDataPackets(
          dataFlowResponse.packets ?? [],
          timelineStartTime,
          totalDuration,
        )

        const initialCurrentTime = get().playbackMode === 'live' ? totalDuration : 0

        set({
          events,
          dataFlows,
          totalDuration,
          currentTime: initialCurrentTime,
          timelineStartTime,
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
      const clampedTime = Math.max(0, Math.min(timeMs, get().totalDuration))
      set({
        currentTime: clampedTime,
        isSeeking: true
      })

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
      const { currentTime, events } = get()
      if (events.length === 0) return

      const nextEvent = events.find(event => event.offsetMs > currentTime)

      if (nextEvent) {
        get().seek(nextEvent.offsetMs)
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

    selectNode: (nodeId: string) => {
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
      set({ timelineZoom: Math.max(0.5, Math.min(2.0, zoom)) })
    },

    appendDataFlows: (packets: RawDataPacket[]) => {
      if (!packets || packets.length === 0) {
        return
      }

      set((state) => {
        const derivedDuration =
          state.totalDuration > 0
            ? state.totalDuration
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

    updateFromLiveEvent: (event: ExecutionLog) => {
      const { events, playbackMode } = get()
      if (playbackMode !== 'live') return

      if (events.some(existing => existing.id === event.id)) {
        return
      }

      const combinedEvents = [...events, event]
      const {
        events: preparedEvents,
        totalDuration,
        timelineStartTime
      } = prepareTimelineEvents(combinedEvents)
      const currentTime = totalDuration

      set((state) => ({
        events: preparedEvents,
        totalDuration,
        timelineStartTime,
        currentTime,
        nodeStates: calculateNodeStates(preparedEvents, state.dataFlows, currentTime, timelineStartTime)
      }))
    },

    switchToLiveMode: () => {
      const { selectedRunId, totalDuration } = get()
      if (!selectedRunId) return

      set({
        playbackMode: 'live',
        currentTime: totalDuration,
        isPlaying: false // Live mode doesn't need play controls
      })

      get().loadTimeline(selectedRunId)
    },

    reset: () => {
      set(INITIAL_STATE)
    },
  }))
)

// Subscribe to execution store for live updates
let unsubscribeExecutionStore: (() => void) | null = null

export const initializeTimelineStore = () => {
  if (unsubscribeExecutionStore) {
    unsubscribeExecutionStore()
  }

  const { useExecutionStore } = require('./executionStore')

  unsubscribeExecutionStore = useExecutionStore.subscribe(
    (state) => state.logs,
    (logs: ExecutionLog[]) => {
      const executionState = useExecutionStore.getState()
      const timelineStore = useExecutionTimelineStore.getState()
      if (timelineStore.playbackMode === 'live' && timelineStore.selectedRunId === executionState.runId) {
        // Update timeline with new logs
        const {
          events,
          totalDuration,
          timelineStartTime
        } = prepareTimelineEvents(logs)
        const currentTime = totalDuration

        useExecutionTimelineStore.setState((state: TimelineState) => ({
          events,
          totalDuration,
          timelineStartTime,
          currentTime,
          nodeStates: calculateNodeStates(events, state.dataFlows, currentTime, timelineStartTime)
        }))
      }
    }
  )
}
