import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useRunStore } from '@/store/runStore'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { useAgentTraces } from '@/hooks/useAgentTraces'
import type { AgentNodeOutput } from '@/types/agent'
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution'

const ACTIVE_RUN_STATUSES = new Set(['RUNNING', 'QUEUED'])

type WorkflowRunResult = {
  runId: string
  result?: {
    outputs?: Record<string, AgentNodeOutput>
  }
}

const formatStructured = (value: unknown, fallback = '—') => {
  if (value === null || value === undefined) {
    return fallback
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
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
  const agentDescriptors = useMemo(
    () =>
      Object.entries(outputs).map(([nodeId, payload]) => ({
        nodeId,
        agentRunId:
          payload && typeof payload === 'object' && 'agentRunId' in payload && typeof (payload as any).agentRunId === 'string'
            ? ((payload as any).agentRunId as string)
            : null,
      })),
    [outputs],
  )
  const { nodes: streamNodes, connected: streamConnected } = useAgentTraces(
    agentDescriptors,
    Boolean(effectiveRunStatus && ACTIVE_RUN_STATUSES.has(effectiveRunStatus)),
  )

  const mergedEntries = useMemo(() => {
    const merged = new Map<string, AgentNodeOutput>()

    Object.entries(outputs).forEach(([nodeId, payload]) => {
      if (payload) {
        merged.set(nodeId, payload)
      }
    })

    Object.entries(streamNodes).forEach(([nodeId, nodeState]) => {
      const existing = merged.get(nodeId) ?? {}
      merged.set(nodeId, {
        ...existing,
        ...nodeState,
      })
    })

    return Array.from(merged.entries()).filter(([, payload]) => {
      if (!payload || typeof payload !== 'object') {
        return false
      }
      const hasTrace = Array.isArray(payload.reasoningTrace) && payload.reasoningTrace.length > 0
      const hasTools =
        Array.isArray(payload.toolInvocations) && payload.toolInvocations.length > 0
      const hasResponse =
        typeof payload.responseText === 'string' && payload.responseText.trim().length > 0
      const isLive = Boolean(payload.live)
      return hasTrace || hasTools || hasResponse || isLive
    })
  }, [outputs, streamNodes])

  const isActiveRun = Boolean(effectiveRunStatus && ACTIVE_RUN_STATUSES.has(effectiveRunStatus))
  const hasEntries = mergedEntries.length > 0

  if (!runId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        Select a workflow run to inspect agent reasoning.
      </div>
    )
  }

  if (!hasEntries) {
    if (isActiveRun) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <p>Waiting for live agent reasoning…</p>
          <p>The agent stream will appear here as soon as the run emits events.</p>
        </div>
      )
    }

    if (loading) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
          Loading agent outputs…
        </div>
      )
    }

    if (error) {
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
            {mergedEntries.length} agent node{mergedEntries.length === 1 ? '' : 's'} captured reasoning for this run.
            Select a node to highlight it on the timeline.
          </span>
          {isActiveRun && (
            <span
              className={cn(
                'font-semibold uppercase tracking-wide',
                streamConnected ? 'text-green-600' : 'text-muted-foreground'
              )}
            >
              {streamConnected ? 'Streaming' : 'Connecting…'}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 space-y-4 p-4">
        {mergedEntries.map(([nodeId, payload]) => {
          const reasoningTrace = Array.isArray(payload.reasoningTrace) ? payload.reasoningTrace : []
          const toolInvocations = Array.isArray(payload.toolInvocations) ? payload.toolInvocations : []
          const isSelected = selectedNodeId === nodeId

          return (
            <div
              key={nodeId}
              className={cn(
                'rounded-lg border bg-background shadow-sm',
                isSelected && 'border-primary shadow-primary/20'
              )}
            >
              <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/50">
                <div>
                  <p className="text-sm font-semibold">{nodeId}</p>
                  <p className="text-xs text-muted-foreground">
                    {reasoningTrace.length} reasoning step{reasoningTrace.length === 1 ? '' : 's'} ·{' '}
                    {toolInvocations.length} tool invocation{toolInvocations.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {payload.live && (
                    <Badge variant="default" className="bg-emerald-600 text-white animate-pulse">
                      Live
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    onClick={() => {
                      setMode('execution')
                      setInspectorTab('events')
                      selectNode(nodeId)
                    }}
                  >
                    {isSelected ? 'Focused' : 'Focus in timeline'}
                  </Button>
                </div>
              </div>
              <div className="space-y-4 p-4">
                {payload.responseText && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Response</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{payload.responseText}</p>
                  </div>
                )}

                {reasoningTrace.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      Reasoning Trace
                    </p>
                    {reasoningTrace.map((step) => (
                      <div key={step.step ?? Math.random()} className="rounded-md border p-3 bg-background/80 space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span>Step {step.step ?? '—'}</span>
                          {step.finishReason && (
                            <Badge variant={step.finishReason === 'stop' ? 'secondary' : 'outline'}>
                              {step.finishReason}
                            </Badge>
                          )}
                        </div>
                        {step.thought && (
                          <p className="whitespace-pre-wrap text-sm">{step.thought}</p>
                        )}

                        {Array.isArray(step.actions) && step.actions.length > 0 && (
                          <div className="rounded bg-muted/40 p-2">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                              Actions
                            </p>
                            <div className="space-y-2 mt-1">
                              {step.actions.map((action, index) => (
                                <div key={`${action.toolCallId ?? index}-action`} className="text-xs">
                                  <p className="font-medium">
                                    {action.toolName ?? 'tool'}{' '}
                                    {action.toolCallId && (
                                      <span className="text-muted-foreground">
                                        ({action.toolCallId})
                                      </span>
                                    )}
                                  </p>
                                  <pre className="mt-1 whitespace-pre-wrap rounded bg-background/60 p-2">
                                    {formatStructured(action.args)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {Array.isArray(step.observations) && step.observations.length > 0 && (
                          <div className="rounded bg-muted/40 p-2">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                              Observations
                            </p>
                            <div className="space-y-2 mt-1">
                              {step.observations.map((obs, index) => (
                                <div key={`${obs.toolCallId ?? index}-obs`} className="text-xs">
                                  <p className="font-medium">
                                    {obs.toolName ?? 'tool'}{' '}
                                    {obs.toolCallId && (
                                      <span className="text-muted-foreground">
                                        ({obs.toolCallId})
                                      </span>
                                    )}
                                  </p>
                                  <p className="mt-1 text-muted-foreground">Args:</p>
                                  <pre className="whitespace-pre-wrap rounded bg-background/60 p-2">
                                    {formatStructured(obs.args)}
                                  </pre>
                                  <p className="mt-1 text-muted-foreground">Result:</p>
                                  <pre className="whitespace-pre-wrap rounded bg-background/60 p-2">
                                    {formatStructured(obs.result)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {toolInvocations.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      Tool Invocations
                    </p>
                    <div className="space-y-3">
                      {toolInvocations.map((invocation, index) => (
                        <div
                          key={invocation.id ?? `${index}-invocation`}
                          className="rounded-md border bg-background/60 p-3 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{invocation.toolName ?? 'tool'}</span>
                            {invocation.timestamp && (
                              <span className="text-muted-foreground">{new Date(invocation.timestamp).toLocaleTimeString()}</span>
                            )}
                          </div>
                          {invocation.id && (
                            <p className="text-muted-foreground">Call ID: {invocation.id}</p>
                          )}
                          <p className="mt-1 text-muted-foreground">Args:</p>
                          <pre className="whitespace-pre-wrap rounded bg-background/60 p-2">
                            {formatStructured(invocation.args)}
                          </pre>
                          <p className="mt-1 text-muted-foreground">Result:</p>
                          <pre className="whitespace-pre-wrap rounded bg-background/60 p-2">
                            {formatStructured(invocation.result)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {payload.usage !== undefined && payload.usage !== null && (
                  <div className="rounded bg-muted/30 p-2 text-xs">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase">Usage</p>
                    <pre className="whitespace-pre-wrap">{formatStructured(payload.usage)}</pre>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
