import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api'
import { FetchEventSource } from '@/utils/sse-client'
import type { AgentStep, AgentToolInvocation } from '@/types/agent'

type AgentStreamEvent = {
  id?: string
  nodeId?: string
  timestamp?: string
  agentEvent?: string
  data?: Record<string, any>
}

type AgentStreamNodeState = {
  steps: AgentStep[]
  toolInvocations: AgentToolInvocation[]
  responseText?: string
  live?: boolean
}

export type AgentStreamState = {
  nodes: Record<string, AgentStreamNodeState>
  connected: boolean
}

const ACTIVE_STATUSES = new Set(['RUNNING', 'QUEUED'])

const upsertStep = (steps: AgentStep[], incoming: AgentStep): AgentStep[] => {
  if (incoming.step === undefined || incoming.step === null) {
    return [...steps, incoming]
  }
  const existingIndex = steps.findIndex((candidate) => candidate.step === incoming.step)
  if (existingIndex === -1) {
    return [...steps, incoming]
  }
  const next = [...steps]
  next[existingIndex] = incoming
  return next
}

const upsertInvocation = (
  invocations: AgentToolInvocation[],
  incoming: AgentToolInvocation
): AgentToolInvocation[] => {
  if (!incoming.id) {
    return [...invocations, incoming]
  }
  const idx = invocations.findIndex((candidate) => candidate.id === incoming.id)
  if (idx === -1) {
    return [...invocations, incoming]
  }
  const next = [...invocations]
  next[idx] = { ...next[idx], ...incoming }
  return next
}

const mapEventState = (
  previous: Record<string, AgentStreamNodeState>,
  events: AgentStreamEvent[]
): Record<string, AgentStreamNodeState> => {
  if (!events.length) {
    return previous
  }

  const next = { ...previous }

  for (const event of events) {
    if (!event.nodeId || !event.agentEvent) {
      continue
    }

    const current: AgentStreamNodeState = next[event.nodeId] ?? {
      steps: [],
      toolInvocations: [],
    }

    switch (event.agentEvent) {
      case 'status': {
        current.live = event.data?.status === 'starting'
        break
      }
      case 'step': {
        if (event.data?.step) {
          current.steps = upsertStep(current.steps, event.data.step as AgentStep)
        }
        current.live = true
        break
      }
      case 'tool_call': {
        current.toolInvocations = upsertInvocation(current.toolInvocations, {
          id: event.data?.toolCallId,
          toolName: event.data?.toolName,
          args: event.data?.args,
          timestamp: event.timestamp ?? new Date().toISOString(),
          metadata: event.data?.metadata,
        })
        current.live = true
        break
      }
      case 'tool_result': {
        current.toolInvocations = upsertInvocation(current.toolInvocations, {
          id: event.data?.toolCallId,
          toolName: event.data?.toolName,
          result: event.data?.result,
          args: event.data?.args,
          timestamp: event.timestamp ?? new Date().toISOString(),
          metadata: event.data?.metadata,
        })
        current.live = true
        break
      }
      case 'tool_error': {
        current.toolInvocations = upsertInvocation(current.toolInvocations, {
          id: event.data?.toolCallId,
          toolName: event.data?.toolName,
          result: {
            error: event.data?.error,
          },
          timestamp: event.timestamp ?? new Date().toISOString(),
          metadata: event.data?.metadata,
        })
        current.live = true
        break
      }
      case 'final': {
        current.responseText = event.data?.responseText ?? current.responseText
        if (Array.isArray(event.data?.reasoningTrace) && event.data.reasoningTrace.length > 0) {
          current.steps = event.data.reasoningTrace as AgentStep[]
        }
        if (Array.isArray(event.data?.toolInvocations)) {
          current.toolInvocations = event.data.toolInvocations as AgentToolInvocation[]
        }
        current.live = false
        break
      }
      default:
        break
    }

    next[event.nodeId] = { ...current }
  }

  return next
}

export function useAgentStream(runId: string | null, runStatus?: string | null): AgentStreamState {
  const [state, setState] = useState<AgentStreamState>({ nodes: {}, connected: false })
  const sourceRef = useRef<FetchEventSource | null>(null)
  const lastRunIdRef = useRef<string | null>(null)

  const enabled = Boolean(runId && runStatus && ACTIVE_STATUSES.has(runStatus))

  useEffect(() => {
    if (runId !== lastRunIdRef.current) {
      lastRunIdRef.current = runId
      setState({ nodes: {}, connected: false })
    }
  }, [runId])

  useEffect(() => {
    if (!runId || !enabled) {
      if (sourceRef.current) {
        sourceRef.current.close()
        sourceRef.current = null
      }
      setState((prev) => ({ ...prev, connected: false }))
      return
    }

    let cancelled = false

    const connect = async () => {
      try {
        const headers = await getApiAuthHeaders()
        if (cancelled) {
          return
        }

        const url = new URL(`/agents/${runId}/stream`, API_BASE_URL)
        const eventSource = new FetchEventSource(url.toString(), { headers })
        sourceRef.current = eventSource

        eventSource.addEventListener('open', () => {
          if (!cancelled) {
            setState((prev) => ({ ...prev, connected: true }))
          }
        })

        eventSource.addEventListener('error', () => {
          if (!cancelled) {
            setState((prev) => ({ ...prev, connected: false }))
          }
        })

        const agentListener = (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data as string)
            const events: AgentStreamEvent[] = Array.isArray(payload.events) ? payload.events : []
            if (events.length === 0) {
              return
            }
            setState((prev) => ({
              ...prev,
              nodes: mapEventState(prev.nodes, events),
            }))
          } catch (error) {
            console.error('Failed to parse agent stream event', error)
          }
        }

        eventSource.addEventListener('agent' as any, agentListener as EventListener)
      } catch (error) {
        console.error('Failed to initialize agent stream', error)
      }
    }

    void connect()

    return () => {
      cancelled = true
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [enabled, runId])

  return useMemo(() => state, [state])
}
