import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  isTextUIPart,
  readUIMessageStream,
  simulateReadableStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useRunStore } from '@/store/runStore'
import { api, buildApiUrl, getApiAuthHeaders } from '@/services/api'
import { cn } from '@/lib/utils'
import type {
  AgentNodeOutput,
  AgentReasoningAction,
  AgentReasoningObservation,
} from '@/types/agent'
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution'

const ACTIVE_RUN_STATUSES = new Set(['RUNNING', 'QUEUED'])

type WorkflowRunResult = {
  runId: string
  result?: {
    outputs?: Record<string, AgentNodeOutput>
  }
}

type AgentTraceChunk = {
  sequence: number
  timestamp: string
  chunk: UIMessageChunk
}

type AgentDerivedStep = {
  key: string
  stepNumber?: number
  finishReason?: string
  thought?: string
  actions: AgentReasoningAction[]
  observations: AgentReasoningObservation[]
  toolCallId?: string
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  timestamp?: string
  sequence: number
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  isComplete: boolean
}

type AgentTranscriptState = {
  loading: boolean
  error: string | null
  cursor: number
  messages: UIMessage[] | null
  parts: AgentTraceChunk[]
  steps: AgentDerivedStep[]
}

interface AgentTracePanelProps {
  runId: string | null
}

export function AgentTracePanel({ runId }: AgentTracePanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<Record<string, AgentNodeOutput>>({})
  const selectedNodeId = useExecutionTimelineStore((state) => state.selectedNodeId)
  const selectNode = useExecutionTimelineStore((state) => state.selectNode)
  const timelineEvents = useExecutionTimelineStore((state) => state.events)
  const setInspectorTab = useWorkflowUiStore((state) => state.setInspectorTab)
  const setMode = useWorkflowUiStore((state) => state.setMode)
  const { runId: liveRunId, status: executionStatus } = useWorkflowExecution()

  useEffect(() => {
    let cancelled = false
    if (!runId) {
      setOutputs({})
      setError(null)
      return
    }

    const fetchResult = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await api.executions.getResult(runId)
        if (cancelled) return
        const typed = result as WorkflowRunResult
        setOutputs(typed.result?.outputs ?? {})
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load agent outputs', err)
        setError(err instanceof Error ? err.message : 'Failed to load agent outputs')
        setOutputs({})
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchResult()
    return () => {
      cancelled = true
    }
  }, [runId])

  const selectedRun = useRunStore((state) => (runId ? state.getRunById(runId) : undefined))
  const runStatus = selectedRun?.status ?? null
  const executionStatusUpper = executionStatus?.toUpperCase()
  const fallbackStatus =
    runId && liveRunId === runId && executionStatusUpper && ACTIVE_RUN_STATUSES.has(executionStatusUpper)
      ? executionStatusUpper
      : null
  const effectiveRunStatus = runStatus ?? fallbackStatus ?? null
  const isActiveRun = Boolean(effectiveRunStatus && ACTIVE_RUN_STATUSES.has(effectiveRunStatus))

  const liveAgentSignals = useMemo(() => {
    const map = new Map<string, string>()
    timelineEvents.forEach((event) => {
      if (!event?.nodeId) {
        return
      }
      const candidate = extractAgentRunId(event.data)
      if (candidate) {
        map.set(event.nodeId, candidate)
      }
    })
    return map
  }, [timelineEvents])

  const userPrompt = useMemo(() => extractAgentPrompt(outputs), [outputs])

  const agentEntries = useMemo(() => {
    const entries = new Map<string, string>()

    liveAgentSignals.forEach((agentRunId, nodeId) => {
      entries.set(nodeId, agentRunId)
    })

    Object.entries(outputs).forEach(([nodeId, payload]) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'agentRunId' in payload &&
        typeof (payload as any).agentRunId === 'string'
      ) {
        entries.set(nodeId, (payload as any).agentRunId as string)
      }
    })

    return Array.from(entries.entries()).map(([nodeId, agentRunId]) => {
      const payload = outputs[nodeId]
      const responseText =
        payload && typeof payload === 'object' && typeof (payload as AgentNodeOutput).responseText === 'string'
          ? (payload as AgentNodeOutput).responseText
          : undefined
      return {
        nodeId,
        agentRunId,
        prompt: userPrompt,
        responseText,
      }
    })
  }, [liveAgentSignals, outputs, userPrompt])

  const hasEntries = agentEntries.length > 0

  if (!runId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        Select a workflow run to inspect agent reasoning.
      </div>
    )
  }

  if (loading && !hasEntries) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        Loading agent outputs…
      </div>
    )
  }

  if (error && !hasEntries) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-destructive">Failed to load agent trace.</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={() => setOutputs({})}>
          Retry
        </Button>
      </div>
    )
  }

  if (!hasEntries) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <p>No AI agent outputs were recorded for this run.</p>
        <p>Run a workflow that includes the core.ai.agent component to view reasoning steps.</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-background/40">
      <div className="border-b bg-background/80 px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>
            {agentEntries.length} agent node{agentEntries.length === 1 ? '' : 's'} captured reasoning for this run.
            Select a node to highlight it on the timeline.
          </span>
          {isActiveRun && (
            <span className="font-semibold uppercase tracking-wide text-emerald-600">Live</span>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-4 p-4">
        {agentEntries.map(({ nodeId, agentRunId, prompt: agentPrompt, responseText }) => (
          <AgentRunCard
            key={nodeId}
            nodeId={nodeId}
            agentRunId={agentRunId}
            runId={runId as string}
            live={isActiveRun && runId === liveRunId}
            isSelected={selectedNodeId === nodeId}
            prompt={agentPrompt}
            responseText={responseText}
            onFocus={() => {
              selectNode(nodeId)
              setMode('execution')
              setInspectorTab('events')
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface AgentRunCardProps {
  nodeId: string
  agentRunId: string
  runId: string
  live: boolean
  isSelected: boolean
  onFocus: () => void
  prompt?: string | null
  responseText?: string | null
}

function AgentRunCard({
  nodeId,
  agentRunId,
  runId,
  live,
  isSelected,
  onFocus,
  prompt,
  responseText,
}: AgentRunCardProps) {
  const {
    loading,
    error,
    cursor,
    messages: initialMessages,
    parts,
    steps,
  } = useAgentTranscript(agentRunId)
  const transport = useAgentChatTransport(agentRunId)
  const { messages, sendMessage, status, setMessages } = useChat({
    id: agentRunId,
    transport: transport ?? undefined,
    messages: [],
  })
  const [visibleMessages, setVisibleMessages] = useState<UIMessage[]>(messages)
  const hydratedRef = useRef(false)
  const startedRef = useRef(false)
  const lastReplaySequenceRef = useRef<number | null>(null)
  const playbackMode = useExecutionTimelineStore((state) => state.playbackMode)
  const timelineStartTime = useExecutionTimelineStore((state) => state.timelineStartTime)
  const timelineCurrentTime = useExecutionTimelineStore((state) => state.currentTime)
  const selectedTimelineRunId = useExecutionTimelineStore((state) => state.selectedRunId)
  const setAgentMarkers = useExecutionTimelineStore((state) => state.setAgentMarkers)

  const sequenceBoundary = useMemo(() => {
    if (!parts || parts.length === 0) {
      return 0
    }
    const lastSequence = parts[parts.length - 1]?.sequence ?? 0
    const isReplayForRun =
      playbackMode === 'replay' && runId && selectedTimelineRunId === runId
    if (!isReplayForRun || !timelineStartTime) {
      return lastSequence
    }
    const cutoffTimestamp = timelineStartTime + timelineCurrentTime
    let boundary = 0
    for (const entry of parts) {
      const entryTime = new Date(entry.timestamp).getTime()
      if (entryTime <= cutoffTimestamp) {
        boundary = entry.sequence
      } else {
        break
      }
    }
    return boundary
  }, [parts, playbackMode, runId, selectedTimelineRunId, timelineStartTime, timelineCurrentTime])

  const finalAssistantText = useMemo(() => {
    if (typeof responseText === 'string' && responseText.trim().length > 0) {
      return responseText
    }
    return extractAssistantText(visibleMessages)
  }, [responseText, visibleMessages])

  const visibleSteps = useMemo(() => {
    if (!sequenceBoundary) {
      return []
    }
    return steps.filter((step) => step.sequence <= sequenceBoundary)
  }, [steps, sequenceBoundary])
  const finalSequence = parts?.length ? parts[parts.length - 1]!.sequence : 0

  useEffect(() => {
    if (!hydratedRef.current && initialMessages) {
      setMessages(initialMessages)
      hydratedRef.current = true
    }
  }, [initialMessages, setMessages])

  useEffect(() => {
    if (!live || startedRef.current || !transport || !hydratedRef.current) {
      return
    }
    startedRef.current = true
    void sendMessage(undefined, {
      body: cursor > 0 ? { cursor } : undefined,
    })
  }, [live, cursor, sendMessage, transport])

  useEffect(() => {
    const isReplayForRun =
      playbackMode === 'replay' && runId && selectedTimelineRunId === runId
    if (!isReplayForRun) {
      lastReplaySequenceRef.current = null
      setVisibleMessages(messages)
    }
  }, [messages, playbackMode, runId, selectedTimelineRunId])

  useEffect(() => {
    if (!sequenceBoundary) {
      lastReplaySequenceRef.current = 0
      setVisibleMessages([])
      return
    }
    const finalSequence = parts?.length ? parts[parts.length - 1]!.sequence : sequenceBoundary
    if (sequenceBoundary >= finalSequence) {
      lastReplaySequenceRef.current = finalSequence
      setVisibleMessages(messages)
      return
    }
    if (lastReplaySequenceRef.current === sequenceBoundary) {
      return
    }
    lastReplaySequenceRef.current = sequenceBoundary
    const subsetChunks =
      parts
        ?.filter((entry) => entry.sequence <= sequenceBoundary)
        .map((entry) => entry.chunk) ?? []
    let cancelled = false
    void (async () => {
      const subsetMessages = await chunksToMessages(subsetChunks)
      if (!cancelled && lastReplaySequenceRef.current === sequenceBoundary) {
        setVisibleMessages(subsetMessages)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sequenceBoundary, parts, messages])

  useEffect(() => {
    if (!runId) {
      return
    }
    const markers =
      steps
        ?.filter((step) => step.startedAt)
        .map((step) => ({
          id: `${agentRunId}-${step.key}`,
          nodeId,
          label: step.toolName
            ? `${step.toolName}${step.stepNumber ? ` • Step ${step.stepNumber}` : ''}`
            : step.stepNumber
              ? `Step ${step.stepNumber}`
              : 'Agent step',
          timestamp: step.startedAt!,
        })) ?? []
    setAgentMarkers(runId, nodeId, markers)
  }, [agentRunId, nodeId, runId, steps, setAgentMarkers])

  useEffect(() => {
    return () => {
      if (runId) {
        setAgentMarkers(runId, nodeId, [])
      }
    }
  }, [runId, nodeId, setAgentMarkers])

  return (
    <div
      className={cn(
        'rounded-lg border bg-background shadow-sm',
        isSelected && 'border-primary shadow-primary/20',
      )}
    >
      <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/50">
        <div>
          <p className="text-sm font-semibold">{nodeId}</p>
          <p className="text-xs text-muted-foreground">Run {agentRunId.slice(-8)}</p>
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <Badge variant="default" className="bg-emerald-600 text-white animate-pulse">
              Live
            </Badge>
          )}
          <Button size="sm" variant={isSelected ? 'default' : 'outline'} onClick={onFocus}>
            {isSelected ? 'Focused' : 'Focus in timeline'}
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {loading && (
          <p className="text-xs text-muted-foreground">Hydrating transcript…</p>
        )}
        {error && (
          <div className="text-xs text-destructive">
            Failed to load transcript: {error}
          </div>
        )}
        {!loading && !error && (
          <AgentTranscriptTimeline
            prompt={prompt}
            steps={visibleSteps}
            finalText={finalAssistantText && sequenceBoundary >= finalSequence ? finalAssistantText : null}
          />
        )}
        {live && (
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Status: {status}
          </p>
        )}
      </div>
    </div>
  )
}

function AgentTranscriptTimeline({
  prompt,
  steps,
  finalText,
}: {
  prompt?: string | null
  steps: AgentDerivedStep[]
  finalText?: string | null
}) {
  const hasPrompt = Boolean(prompt && prompt.trim().length > 0)
  const hasFinal = Boolean(finalText && finalText.trim().length > 0)
  const hasSteps = steps.length > 0

  if (!hasPrompt && !hasSteps && !hasFinal) {
    return <p className="text-xs text-muted-foreground">No agent activity captured yet.</p>
  }

  return (
    <div className="space-y-3">
      {hasPrompt && <AgentPromptCard prompt={prompt!.trim()} />}
      {hasSteps &&
        steps.map((step) => (
          <AgentStepCard key={step.key} step={step} />
        ))}
      {hasFinal && <AgentFinalResponseCard text={finalText!.trim()} />}
    </div>
  )
}

function AgentPromptCard({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-sm">
      <p className="text-[11px] uppercase text-muted-foreground">Agent Prompt</p>
      <p className="mt-1 whitespace-pre-wrap text-foreground">{prompt}</p>
    </div>
  )
}

function AgentStepCard({ step }: { step: AgentDerivedStep }) {
  const label = step.stepNumber ? `Step ${step.stepNumber}` : 'Step'
  const badge = step.isComplete
    ? step.finishReason ?? 'complete'
    : 'working'
  const showActions = step.actions && step.actions.length > 1
  const additionalObservations =
    step.observations && step.observations.length > (step.toolOutput ? 1 : 0)
  const startedAt = step.startedAt ? formatClock(step.startedAt) : null
  const finishedAt = step.finishedAt ? formatClock(step.finishedAt) : null
  const duration =
    step.durationMs && step.durationMs > 0
      ? formatDuration(step.durationMs)
      : null
  const toolInputSummary =
    step.toolInput !== null && step.toolInput !== undefined
      ? summarizeUnknown(step.toolInput)
      : null
  const toolOutputSummary =
    step.toolOutput !== null && step.toolOutput !== undefined
      ? summarizeUnknown(step.toolOutput)
      : null

  return (
    <div className="space-y-3 rounded-lg border bg-background/80 p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
          {label}
        </span>
        {badge && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {badge}
          </span>
        )}
      </div>
      {(startedAt || finishedAt || duration) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {startedAt && <span>Start {startedAt}</span>}
          {finishedAt && <span>End {finishedAt}</span>}
          {duration && <span>{duration}</span>}
        </div>
      )}
      {!step.isComplete && (
        <p className="text-[11px] font-semibold text-amber-600">Waiting for tool output…</p>
      )}
      {(step.toolName || step.toolCallId) && (
        <div className="rounded-md border border-muted-foreground/20 bg-muted/20 p-2">
          <p className="text-xs font-semibold text-foreground">
            {step.toolName ?? 'Tool invocation'}
          </p>
          {toolInputSummary && (
            <p className="text-muted-foreground">
              Input: <span className="text-foreground">{toolInputSummary}</span>
            </p>
          )}
          {toolOutputSummary && (
            <p className="text-muted-foreground">
              Output:{' '}
              <span className="text-foreground">{toolOutputSummary}</span>
            </p>
          )}
          {step.toolCallId && (
            <p className="mt-1 text-[10px] text-muted-foreground">Call ID: {step.toolCallId}</p>
          )}
        </div>
      )}
      {showActions && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase text-muted-foreground">Actions</p>
          <ul className="space-y-1">
            {step.actions.map((action, index) => (
              <li
                key={action.toolCallId ?? `${action.toolName}-action-${index}`}
                className="rounded-md bg-background/70 px-2 py-1"
              >
                <p className="font-semibold">{action.toolName ?? 'tool'}</p>
                {action.args !== undefined && action.args !== null && (
                  <p className="text-muted-foreground">
                    {summarizeUnknown(action.args)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {additionalObservations && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase text-muted-foreground">Observations</p>
          <ul className="space-y-1">
            {step.observations.map((observation, index) => (
              <li
                key={observation.toolCallId ?? `${observation.toolName}-observation-${index}`}
                className="rounded-md border border-dashed border-muted-foreground/40 px-2 py-1"
              >
                <p className="font-semibold">{observation.toolName ?? 'tool'}</p>
                {observation.result !== undefined && observation.result !== null && (
                  <p className="text-muted-foreground">
                    {summarizeUnknown(observation.result)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.thought && (
        <ExpandableText text={step.thought} className="text-sm text-foreground" />
      )}
    </div>
  )
}

function AgentFinalResponseCard({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm shadow-sm">
      <p className="text-[11px] uppercase text-primary">Final Answer</p>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{text}</p>
    </div>
  )
}

function ExpandableText({
  text,
  limit = 220,
  className,
}: {
  text: string
  limit?: number
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const shouldTruncate = text.length > limit
  const displayText = expanded || !shouldTruncate ? text : `${text.slice(0, limit)}…`
  return (
    <div className="space-y-1">
      <p className={cn('whitespace-pre-wrap leading-relaxed', className)}>{displayText}</p>
      {shouldTruncate && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-[11px] font-semibold text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function summarizeUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value && typeof value === 'object') {
    if ('fact' in (value as Record<string, unknown>) && typeof (value as Record<string, unknown>).fact === 'string') {
      return (value as Record<string, unknown>).fact as string
    }
    if ('message' in (value as Record<string, unknown>) && typeof (value as Record<string, unknown>).message === 'string') {
      return (value as Record<string, unknown>).message as string
    }
  }
  const formatted = formatStructured(value)
  return formatted.length > 200 ? `${formatted.slice(0, 200)}…` : formatted
}

function extractAssistantText(messages: UIMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') {
      continue
    }
    const text = message.parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (text.length > 0) {
      return text
    }
  }
  return null
}

function extractAgentPrompt(outputs: Record<string, AgentNodeOutput>): string | undefined {
  const direct = outputs['manual-trigger']
  if (direct && typeof direct === 'object') {
    const candidate = (direct as Record<string, unknown>).userPrompt
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }
  for (const value of Object.values(outputs)) {
    if (!value || typeof value !== 'object') {
      continue
    }
    if (typeof (value as Record<string, unknown>).userPrompt === 'string') {
      const prompt = (value as Record<string, unknown>).userPrompt as string
      if (prompt.trim().length > 0) {
        return prompt
      }
    }
    if (typeof (value as Record<string, unknown>).prompt === 'string') {
      const prompt = (value as Record<string, unknown>).prompt as string
      if (prompt.trim().length > 0) {
        return prompt
      }
    }
  }
  return undefined
}

function formatClock(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return timestamp
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }
  const seconds = durationMs / 1000
  return `${seconds.toFixed(1)} s`
}

function ensureString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function useAgentTranscript(agentRunId: string | null): AgentTranscriptState {
  const [state, setState] = useState<AgentTranscriptState>({
    loading: false,
    error: null,
    cursor: 0,
    messages: null,
    parts: [],
    steps: [],
  })

  useEffect(() => {
    let cancelled = false
    if (!agentRunId) {
      setState({ loading: false, error: null, cursor: 0, messages: null, parts: [], steps: [] })
      return
    }

    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }))
      try {
        const headers = await getApiAuthHeaders()
        const response = await fetch(buildApiUrl(`/api/v1/agents/${agentRunId}/parts`), {
          headers,
        })
        if (!response.ok) {
          throw new Error(`Failed to load agent trace for ${agentRunId}`)
        }
        const data = await response.json()
        const parts: AgentTraceChunk[] = Array.isArray(data?.parts)
          ? data.parts
              .map(
                (entry: {
                  sequence?: number | null
                  timestamp?: string | null
                  chunk?: UIMessageChunk | null
                }) => {
                  if (!entry?.chunk) {
                    return null
                  }
                  return {
                    sequence: typeof entry.sequence === 'number' ? entry.sequence : 0,
                    timestamp:
                      typeof entry.timestamp === 'string'
                        ? entry.timestamp
                        : new Date().toISOString(),
                    chunk: entry.chunk,
                  }
                },
              )
              .filter(
                (entry: AgentTraceChunk | null): entry is AgentTraceChunk => Boolean(entry),
              )
          : []
        const chunks: UIMessageChunk[] = parts.map((entry) => entry.chunk)
        const messages = await chunksToMessages(chunks)
        const steps = deriveAgentSteps(parts)
        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            cursor:
              typeof data?.cursor === 'number'
                ? data.cursor
                : parts.length > 0
                  ? parts[parts.length - 1]!.sequence
                  : 0,
            messages,
            parts,
            steps,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load transcript',
            cursor: 0,
            messages: null,
            parts: [],
            steps: [],
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [agentRunId])

  return state
}

function useAgentChatTransport(agentRunId: string | null) {
  return useMemo(() => {
    if (!agentRunId) {
      return null
    }
    return new DefaultChatTransport({
      prepareSendMessagesRequest: async ({ body, headers }) => {
        const authHeaders = await getApiAuthHeaders()
        return {
          api: buildApiUrl(`/api/v1/agents/${agentRunId}/chat`),
          body: body ?? {},
          headers: {
            ...headersInitToRecord(headers),
            ...authHeaders,
          },
        }
      },
      prepareReconnectToStreamRequest: async ({ headers }) => {
        const authHeaders = await getApiAuthHeaders()
        return {
          api: buildApiUrl(`/api/v1/agents/${agentRunId}/chat`),
          headers: {
            ...headersInitToRecord(headers),
            ...authHeaders,
          },
        }
      },
    })
  }, [agentRunId])
}

async function chunksToMessages(chunks: UIMessageChunk[]): Promise<UIMessage[]> {
  if (!chunks.length) {
    return []
  }
  const stream = simulateReadableStream<UIMessageChunk>({ chunks })
  const iterator = readUIMessageStream({ stream })
  const snapshots: UIMessage[] = []
  for await (const message of iterator) {
    snapshots.push(message)
  }
  const latestById = new Map<string, UIMessage>()
  const orderedIds: string[] = []
  for (const snapshot of snapshots) {
    const key = snapshot.id ?? `message-${orderedIds.length}`
    if (!latestById.has(key)) {
      orderedIds.push(key)
    }
    latestById.set(key, snapshot)
  }
  return orderedIds
    .map((id) => latestById.get(id))
    .filter((message): message is UIMessage => Boolean(message))
}

function deriveAgentSteps(parts: AgentTraceChunk[]): AgentDerivedStep[] {
  if (!parts.length) {
    return []
  }

  type Snapshot = {
    id?: string
    hasReasoning: boolean
    step: AgentDerivedStep
  }

  const snapshots: Snapshot[] = []
  const snapshotById = new Map<string, Snapshot>()
  const steps: AgentDerivedStep[] = []

  const ensureDateMs = (iso?: string) => {
    if (!iso) return undefined
    const value = new Date(iso).getTime()
    return Number.isNaN(value) ? undefined : value
  }

  const createSnapshotStep = ({
    toolCallId,
    toolName,
    input,
    timestamp,
    sequence,
  }: {
    toolCallId?: string
    toolName?: string
    input?: unknown
    timestamp: string
    sequence: number
  }): Snapshot => {
    const step: AgentDerivedStep = {
      key: toolCallId ? `tool-${toolCallId}` : `tool-${sequence}`,
      actions: [],
      observations: [],
      toolCallId,
      toolName,
      toolInput: input ?? null,
      toolOutput: undefined,
      timestamp,
      sequence,
      startedAt: timestamp,
      isComplete: false,
    }
    const snapshot: Snapshot = { id: toolCallId, step, hasReasoning: false }
    snapshots.push(snapshot)
    if (toolCallId) {
      snapshotById.set(toolCallId, snapshot)
    }
    steps.push(step)
    return snapshot
  }

  const findFallbackSnapshot = () => snapshots.find((candidate) => !candidate.hasReasoning)

  const markCompletion = (step: AgentDerivedStep) => {
    step.isComplete = Boolean(
      step.finishedAt ||
        (step.finishReason && step.finishReason !== 'tool-calls'),
    )
  }

  parts.forEach((entry) => {
    const chunk = entry.chunk as any
    if (chunk?.type === 'tool-input-available') {
      createSnapshotStep({
        toolCallId: ensureString(chunk.toolCallId),
        toolName: ensureString(chunk.toolName),
        input: chunk.input ?? null,
        timestamp: entry.timestamp,
        sequence: entry.sequence,
      })
    }

    if (chunk?.type === 'tool-output-available') {
      const toolCallId = ensureString(chunk.toolCallId)
      let snapshot = toolCallId ? snapshotById.get(toolCallId) : undefined
      if (!snapshot) {
        snapshot = findFallbackSnapshot()
      }
      if (!snapshot) {
        snapshot = createSnapshotStep({
          toolCallId,
          toolName: ensureString(chunk.toolName),
          input: null,
          timestamp: entry.timestamp,
          sequence: entry.sequence,
        })
      }
      if (chunk.toolName && !snapshot.step.toolName) {
        snapshot.step.toolName = ensureString(chunk.toolName)
      }
      snapshot.step.toolOutput = chunk.output ?? null
      snapshot.step.finishedAt = entry.timestamp
      const startedAtMs = ensureDateMs(snapshot.step.startedAt)
      const finishedAtMs = ensureDateMs(snapshot.step.finishedAt)
      if (startedAtMs !== undefined && finishedAtMs !== undefined) {
        snapshot.step.durationMs = Math.max(0, finishedAtMs - startedAtMs)
      }
      markCompletion(snapshot.step)
    }

    if (chunk?.type === 'data-reasoning-step') {
      const payload = (chunk?.data ?? {}) as Record<string, unknown>
      const actions: AgentReasoningAction[] = Array.isArray(payload?.actions)
        ? payload.actions
        : []
      const observations: AgentReasoningObservation[] = Array.isArray(payload?.observations)
        ? payload.observations
        : []
      let snapshot: Snapshot | undefined
      const idsToCheck = [
        ensureString(actions[0]?.toolCallId),
        ensureString(observations[0]?.toolCallId),
      ]
      for (const candidateId of idsToCheck) {
        if (candidateId && snapshotById.has(candidateId)) {
          snapshot = snapshotById.get(candidateId)
          break
        }
      }
      if (!snapshot && (actions.length > 0 || observations.length > 0)) {
        snapshot = findFallbackSnapshot()
      }
      const targetStep =
        snapshot?.step ??
        ((() => {
          const implicitStep: AgentDerivedStep = {
            key: `step-${payload?.step ?? entry.sequence}`,
            actions: [],
            observations: [],
            sequence: entry.sequence,
            timestamp: entry.timestamp,
            startedAt: entry.timestamp,
            isComplete: false,
          }
          steps.push(implicitStep)
          return implicitStep
        })())
      if (snapshot) {
        snapshot.hasReasoning = true
      }
      targetStep.stepNumber =
        typeof payload?.step === 'number' ? payload.step : targetStep.stepNumber
      targetStep.finishReason =
        typeof payload?.finishReason === 'string'
          ? payload.finishReason
          : targetStep.finishReason
      targetStep.thought =
        typeof payload?.thought === 'string' ? payload.thought : targetStep.thought
      targetStep.actions = actions
      targetStep.observations = observations
      const inferredToolId =
        ensureString(actions[0]?.toolCallId) ?? ensureString(observations[0]?.toolCallId)
      if (!targetStep.toolCallId && inferredToolId) {
        targetStep.toolCallId = inferredToolId
      }
      if (
        !targetStep.toolName &&
        (actions[0]?.toolName || observations[0]?.toolName)
      ) {
        targetStep.toolName = actions[0]?.toolName ?? observations[0]?.toolName
      }
      if (actions[0]?.args && targetStep.toolInput === undefined) {
        targetStep.toolInput = actions[0]?.args
      }
      if (observations[0]?.result && targetStep.toolOutput === undefined) {
        targetStep.toolOutput = observations[0]?.result
      }
      targetStep.timestamp = targetStep.timestamp ?? entry.timestamp
      targetStep.sequence = Math.min(targetStep.sequence, entry.sequence)
      if (
        !targetStep.finishedAt &&
        targetStep.finishReason &&
        targetStep.finishReason !== 'tool-calls'
      ) {
        targetStep.finishedAt = entry.timestamp
      }
      if (!targetStep.startedAt) {
        targetStep.startedAt = entry.timestamp
      }
      markCompletion(targetStep)
    }
  })

  return steps
    .sort((a, b) => {
      if (a.stepNumber && b.stepNumber) {
        return a.stepNumber - b.stepNumber
      }
      if (a.stepNumber && !b.stepNumber) {
        return -1
      }
      if (!a.stepNumber && b.stepNumber) {
        return 1
      }
      const aTime = ensureDateMs(a.startedAt) ?? a.sequence
      const bTime = ensureDateMs(b.startedAt) ?? b.sequence
      return aTime - bTime
    })
    .map((step, index) => ({
      ...step,
      key: step.key ?? `step-${index}`,
    }))
}

function headersInitToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {}
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})
  }
  return { ...(headers as Record<string, string>) }
}

function formatStructured(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
function extractAgentRunId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }
  const candidate = (data as Record<string, unknown>).agentRunId
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}
