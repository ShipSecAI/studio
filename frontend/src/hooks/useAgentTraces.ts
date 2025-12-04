import { useEffect, useMemo, useRef, useState } from 'react'
import { buildApiUrl, getApiAuthHeaders } from '@/services/api'
import { FetchEventSource } from '@/utils/sse-client'
import type { AgentNodeOutput, AgentStep, AgentToolInvocation } from '@/types/agent'

type AgentDescriptor = {
  nodeId: string
  agentRunId: string | null
}

type AgentStreamEvent = {
  type?: string
  sequence?: number
  timestamp?: string
  payload?: Record<string, any>
}

type AgentTraceState = {
  nodes: Record<string, AgentNodeOutput>
  connected: boolean
}

const createInitialNodeState = (): AgentNodeOutput => ({
  reasoningTrace: [],
  toolInvocations: [],
  responseText: '',
  live: true,
})

const upsertStep = (steps: AgentStep[], incoming: AgentStep): AgentStep[] => {
  if (incoming.step === undefined || incoming.step === null) {
    return [...steps, incoming]
  }
  const idx = steps.findIndex((candidate) => candidate.step === incoming.step)
  if (idx === -1) {
    return [...steps, incoming]
  }
  const next = [...steps]
  next[idx] = incoming
  return next
}

const upsertInvocation = (invocations: AgentToolInvocation[], incoming: AgentToolInvocation): AgentToolInvocation[] => {
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

const applyPart = (prev: AgentNodeOutput, event: AgentStreamEvent): AgentNodeOutput => {
  if (!event?.type) {
    return prev
  }
  const payload = event.payload ?? {}
  switch (event.type) {
    case 'data-reasoning-step': {
      if (payload?.data) {
        const step = payload.data as AgentStep
        const nextSteps = upsertStep(Array.isArray(prev.reasoningTrace) ? prev.reasoningTrace : [], step)
        return { ...prev, reasoningTrace: nextSteps }
      }
      return prev
    }
    case 'tool-input-available': {
      const invocations = upsertInvocation(Array.isArray(prev.toolInvocations) ? prev.toolInvocations : [], {
        id: payload.toolCallId ?? payload.id ?? event.sequence?.toString(),
        toolName: payload.toolName,
        args: payload.input,
        timestamp: event.timestamp ?? new Date().toISOString(),
      })
      return { ...prev, toolInvocations: invocations }
    }
    case 'tool-output-available': {
      const invocations = upsertInvocation(Array.isArray(prev.toolInvocations) ? prev.toolInvocations : [], {
        id: payload.toolCallId ?? payload.id ?? event.sequence?.toString(),
        toolName: payload.toolName,
        result: payload.output,
        timestamp: event.timestamp ?? new Date().toISOString(),
      })
      return { ...prev, toolInvocations: invocations }
    }
    case 'data-tool-error': {
      const invocations = upsertInvocation(Array.isArray(prev.toolInvocations) ? prev.toolInvocations : [], {
        id: payload.toolCallId ?? payload.id ?? event.sequence?.toString(),
        toolName: payload.toolName,
        result: { error: payload.error },
        timestamp: event.timestamp ?? new Date().toISOString(),
      })
      return { ...prev, toolInvocations: invocations }
    }
    case 'text-delta': {
      const nextText = `${prev.responseText ?? ''}${payload?.textDelta ?? ''}`
      return { ...prev, responseText: nextText }
    }
    case 'finish': {
      const finalText = payload?.responseText ?? prev.responseText ?? ''
      return { ...prev, responseText: finalText, live: false }
    }
    case 'message-start': {
      return { ...prev, live: true }
    }
    default:
      return prev
  }
}

const reduceParts = (parts: AgentStreamEvent[]): AgentNodeOutput => {
  if (!parts.length) {
    return createInitialNodeState()
  }
  return parts.reduce((state, part) => applyPart(state, part), createInitialNodeState())
}

const serializeDescriptors = (descriptors: AgentDescriptor[]): string => {
  const sorted = [...descriptors].sort((a, b) => a.nodeId.localeCompare(b.nodeId))
  return JSON.stringify(sorted)
}

export function useAgentTraces(descriptors: AgentDescriptor[], live: boolean): AgentTraceState {
  const [nodes, setNodes] = useState<Record<string, AgentNodeOutput>>({})
  const [connected, setConnected] = useState(false)
  const sourcesRef = useRef<Map<string, FetchEventSource>>(new Map())
  const sequencesRef = useRef<Map<string, number>>(new Map())

  const descriptorKey = useMemo(() => serializeDescriptors(descriptors), [descriptors])

  // ensure state has entries for the current descriptors
  useEffect(() => {
    setNodes((prev) => {
      const next: Record<string, AgentNodeOutput> = { ...prev }
      descriptors.forEach(({ nodeId, agentRunId }) => {
        if (!agentRunId) {
          return
        }
        if (!next[nodeId]) {
          next[nodeId] = { ...createInitialNodeState(), agentRunId }
        } else if (next[nodeId]?.agentRunId !== agentRunId) {
          next[nodeId] = { ...createInitialNodeState(), agentRunId }
        } else {
          next[nodeId] = { ...next[nodeId], agentRunId }
        }
      })
      return next
    })
  }, [descriptorKey, descriptors])

  // fetch initial parts for each descriptor
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!descriptors.length) {
        return
      }
      const headers = await getApiAuthHeaders()
      await Promise.all(
        descriptors.map(async ({ nodeId, agentRunId }) => {
          if (!agentRunId) {
            return
          }
          try {
            const response = await fetch(buildApiUrl(`/api/v1/agents/${agentRunId}/parts`), {
              headers,
            })
            if (!response.ok) {
              throw new Error(`Failed to load agent trace for ${agentRunId}`)
            }
            const data = await response.json()
            if (cancelled) {
              return
            }
            const parts: AgentStreamEvent[] = Array.isArray(data?.parts) ? data.parts : []
            const reduced = reduceParts(parts)
            const cursor =
              typeof data?.cursor === 'number' && Number.isFinite(data.cursor) ? data.cursor : 0
            sequencesRef.current.set(agentRunId, cursor)
            setNodes((prev) => ({
              ...prev,
              [nodeId]: {
                ...reduced,
                agentRunId,
              },
            }))
          } catch (error) {
            console.error(error)
          }
        }),
      )
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [descriptorKey, descriptors])

  // manage live streams
  useEffect(() => {
    if (!live || descriptors.length === 0) {
      sourcesRef.current.forEach((source) => source.close())
      sourcesRef.current.clear()
      setConnected(false)
      return
    }

    let cancelled = false
    const activeSources = new Map<string, FetchEventSource>()

    const connect = async (nodeId: string, agentRunId: string) => {
      try {
        const headers = await getApiAuthHeaders()
        const cursor = sequencesRef.current.get(agentRunId) ?? 0
        const endpoint = new URL(buildApiUrl(`/api/v1/agents/${agentRunId}/stream`))
        if (cursor > 0) {
          endpoint.searchParams.set('cursor', cursor.toString())
        }
        const source = new FetchEventSource(endpoint.toString(), { headers })
        activeSources.set(agentRunId, source)
        sourcesRef.current.set(agentRunId, source)
        setConnected(true)

        const handleMessage = (event: MessageEvent) => {
          const raw = event.data as string
          if (!raw) {
            return
          }
          let parsed: AgentStreamEvent | null = null
          try {
            parsed = JSON.parse(raw) as AgentStreamEvent
          } catch {
            return
          }
          if (!parsed) {
            return
          }
          if (typeof parsed.sequence === 'number') {
            sequencesRef.current.set(agentRunId, parsed.sequence)
          }
          setNodes((prev) => {
            const current = prev[nodeId] ?? createInitialNodeState()
            const updated = applyPart(current, parsed!)
            return {
              ...prev,
              [nodeId]: {
                ...updated,
                agentRunId,
              },
            }
          })
          if (parsed.type === 'finish') {
            source.close()
            activeSources.delete(agentRunId)
            if (activeSources.size === 0) {
              setConnected(false)
            }
          }
        }

        const handleCursor = (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data as string)
            if (typeof payload?.cursor === 'number') {
              sequencesRef.current.set(agentRunId, payload.cursor)
            }
          } catch {
            // ignore
          }
        }

        source.addEventListener('message', handleMessage as EventListener)
        source.addEventListener('cursor' as any, handleCursor as EventListener)
        source.addEventListener('error', () => {
          activeSources.delete(agentRunId)
          if (activeSources.size === 0) {
            setConnected(false)
          }
        })
      } catch (error) {
        console.error('Failed to connect agent stream', { agentRunId, error })
      }
    }

    descriptors.forEach(({ nodeId, agentRunId }) => {
      if (!agentRunId) {
        return
      }
      void connect(nodeId, agentRunId)
    })

    return () => {
      cancelled = true
      activeSources.forEach((source) => source.close())
      sourcesRef.current.forEach((source) => source.close())
      sourcesRef.current.clear()
      if (!cancelled) {
        setConnected(false)
      }
    }
  }, [descriptorKey, descriptors, live])

  return useMemo(
    () => ({
      nodes,
      connected,
    }),
    [nodes, connected],
  )
}
