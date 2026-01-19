import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';
import { api } from '@/services/api';
import { deserializeNodes, deserializeEdges } from '@/utils/workflowSerializer';
import { cloneNodes, cloneEdges, type GraphSnapshot } from './useWorkflowGraphControllers';
import { useRunStore } from '@/store/runStore';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useExecutionStore } from '@/store/executionStore';
import { normalizeRunSummary, isRunLive } from '@/features/workflow-builder/utils/executionRuns';

type ToastFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'warning' | 'success';
  duration?: number;
}) => void;

type SetNodesFn = (setter: SetStateAction<ReactFlowNode<FrontendNodeData>[]>) => void;
type SetEdgesFn = (setter: SetStateAction<ReactFlowEdge[]>) => void;

interface UseWorkflowExecutionLifecycleOptions {
  workflowId: string | null | undefined;
  metadata: {
    id: string | null;
    currentVersionId: string | null;
  };
  routeRunId?: string;
  selectedRunId: string | null;
  mode: 'design' | 'execution';
  builderRoutePrefix: string;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  toast: ToastFn;
  setMode: (mode: 'design' | 'execution') => void;
  designNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  designEdgesRef: React.MutableRefObject<ReactFlowEdge[]>;
  designSavedSnapshotRef: React.MutableRefObject<GraphSnapshot | null>;
  executionNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  executionEdgesRef: React.MutableRefObject<ReactFlowEdge[]>;
  preservedExecutionStateRef: React.MutableRefObject<GraphSnapshot | null>;
  executionLoadedSnapshotRef: React.MutableRefObject<GraphSnapshot | null>;
  setExecutionNodes: SetNodesFn;
  setExecutionEdges: SetEdgesFn;
  setExecutionDirty: (dirty: boolean) => void;
}

interface UseWorkflowExecutionLifecycleResult {
  mostRecentRunId: string | null;
  fetchRuns: (params: { workflowId: string; force?: boolean }) => Promise<unknown>;
  resetHistoricalTracking: () => void;
}

// Stable empty array to prevent useSyncExternalStore infinite loop warnings
const EMPTY_RUNS: never[] = [];

export function useWorkflowExecutionLifecycle({
  workflowId,
  metadata,
  routeRunId,
  selectedRunId,
  mode,
  builderRoutePrefix,
  navigate,
  toast,
  setMode,
  designNodesRef,
  designEdgesRef,
  designSavedSnapshotRef,
  executionNodesRef,
  executionEdgesRef,
  preservedExecutionStateRef,
  executionLoadedSnapshotRef,
  setExecutionNodes,
  setExecutionEdges,
  setExecutionDirty,
}: UseWorkflowExecutionLifecycleOptions): UseWorkflowExecutionLifecycleResult {
  const fetchRuns = useRunStore((state) => state.fetchRuns);
  const refreshRuns = useRunStore((state) => state.refreshRuns);
  const getRunById = useRunStore((state) => state.getRunById);
  const upsertRun = useRunStore((state) => state.upsertRun);
  const workflowCacheKey = workflowId ?? '__global__';
  const workflowRuns = useRunStore((state) => state.cache[workflowCacheKey]?.runs ?? EMPTY_RUNS);
  const [historicalVersionId, setHistoricalVersionId] = useState<string | null>(null);
  const prevRunIdRef = useRef<string | null>(null);
  const prevVersionIdRef = useRef<string | null>(null);
  const latestTargetRunIdRef = useRef<string | null>(null);
  // Track the last routeRunId we processed to prevent re-processing the same run
  const lastProcessedRouteRunIdRef = useRef<string | null>(null);
  const selectRun = useExecutionTimelineStore((state) => state.selectRun);

  const mostRecentRunId = useMemo(
    () => (workflowRuns.length > 0 ? workflowRuns[0].id : null),
    [workflowRuns],
  );

  const resetHistoricalTracking = useCallback(() => {
    setHistoricalVersionId(null);
    prevRunIdRef.current = null;
    prevVersionIdRef.current = null;
    lastProcessedRouteRunIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!metadata.id) {
      useExecutionTimelineStore.getState().reset();
      return;
    }

    fetchRuns({ workflowId: metadata.id }).catch(() => undefined);
  }, [fetchRuns, metadata.id]);

  useEffect(() => {
    if (!metadata.id || !routeRunId) {
      return;
    }

    // Check if we already processed this routeRunId to prevent loops
    if (lastProcessedRouteRunIdRef.current === routeRunId) {
      return;
    }

    // Check directly from store (not the prop which may be stale due to render timing)
    const currentSelectedRunId = useExecutionTimelineStore.getState().selectedRunId;
    if (currentSelectedRunId === routeRunId) {
      lastProcessedRouteRunIdRef.current = routeRunId;
      return;
    }

    let cancelled = false;

    const ensureRouteRun = async () => {
      let targetRun = getRunById(routeRunId);

      if (!targetRun) {
        try {
          await refreshRuns(metadata.id!);
          targetRun = getRunById(routeRunId);
        } catch (error) {
          console.error('Failed to refresh runs for route:', error);
        }
      }

      if (!targetRun) {
        try {
          const runDetails = await api.executions.getRun(routeRunId);
          if (cancelled) return;
          const normalized = normalizeRunSummary(runDetails);
          upsertRun(normalized);
          targetRun = normalized;
        } catch (error) {
          if (cancelled) return;
          console.error('Failed to load workflow run from route:', error);
          toast({
            variant: 'destructive',
            title: 'Run not found',
            description: 'This execution may have been deleted or is no longer available.',
          });
          navigate(`${builderRoutePrefix}/${metadata.id}`, { replace: true });
          return;
        }
      }

      if (cancelled || !targetRun) {
        return;
      }

      if (targetRun.workflowId && targetRun.workflowId !== metadata.id) {
        navigate(`${builderRoutePrefix}/${targetRun.workflowId}/runs/${routeRunId}`, {
          replace: true,
        });
        return;
      }

      // Mark as processed BEFORE calling selectRun to prevent loops
      lastProcessedRouteRunIdRef.current = routeRunId;

      try {
        await selectRun(routeRunId, isRunLive(targetRun) ? 'live' : 'replay');
        setMode('execution');
        if (isRunLive(targetRun)) {
          useExecutionStore.getState().monitorRun(routeRunId, targetRun.workflowId);
        }
      } catch (error) {
        console.error('Failed to select run from route:', error);
      }
    };

    void ensureRouteRun();

    return () => {
      cancelled = true;
    };
  }, [
    builderRoutePrefix,
    metadata.id,
    navigate,
    refreshRuns,
    routeRunId,
    getRunById,
    upsertRun,
    toast,
    setMode,
    selectRun,
  ]);

  useEffect(() => {
    if (mode !== 'execution' || !metadata.id) {
      return;
    }

    const targetRunId = selectedRunId ?? routeRunId ?? mostRecentRunId;

    if (!targetRunId) {
      preservedExecutionStateRef.current = null;
      setExecutionDirty(false);

      if (designSavedSnapshotRef.current) {
        const savedNodes = cloneNodes(designSavedSnapshotRef.current.nodes);
        const savedEdges = cloneEdges(designSavedSnapshotRef.current.edges);
        const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
        setExecutionNodes([...savedNodes, ...terminalNodes]);
        setExecutionEdges(savedEdges);
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(savedNodes),
          edges: cloneEdges(savedEdges),
        };
      } else {
        const designNodesCopy = cloneNodes(designNodesRef.current);
        const designEdgesCopy = cloneEdges(designEdgesRef.current);
        const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
        setExecutionNodes([...designNodesCopy, ...terminalNodes]);
        setExecutionEdges(designEdgesCopy);
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(designNodesCopy),
          edges: cloneEdges(designEdgesCopy),
        };
      }

      if (historicalVersionId) {
        setHistoricalVersionId(null);
      }
      prevRunIdRef.current = null;
      prevVersionIdRef.current = null;
      return;
    }

    let run = getRunById(targetRunId);
    if (!run) {
      run = workflowRuns.find((candidate) => candidate.id === targetRunId);
    }

    // If execution graph is empty when navigating directly to a run, hydrate from the latest
    // design snapshot so the canvas isn't blank while we load the historical version.
    if (executionNodesRef.current.length === 0 && executionEdgesRef.current.length === 0) {
      if (designSavedSnapshotRef.current) {
        const savedNodes = cloneNodes(designSavedSnapshotRef.current.nodes);
        const savedEdges = cloneEdges(designSavedSnapshotRef.current.edges);
        const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
        setExecutionNodes([...savedNodes, ...terminalNodes]);
        setExecutionEdges(savedEdges);
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(savedNodes),
          edges: cloneEdges(savedEdges),
        };
      } else {
        const designNodesCopy = cloneNodes(designNodesRef.current);
        const designEdgesCopy = cloneEdges(designEdgesRef.current);
        const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
        setExecutionNodes([...designNodesCopy, ...terminalNodes]);
        setExecutionEdges(designEdgesCopy);
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(designNodesCopy),
          edges: cloneEdges(designEdgesCopy),
        };
      }
    }

    const versionId = run?.workflowVersionId ?? null;
    const currentRunId = run?.id ?? null;

    const runIdChanged = currentRunId !== prevRunIdRef.current;
    const versionIdChanged = versionId !== prevVersionIdRef.current;

    if (!runIdChanged && !versionIdChanged && prevRunIdRef.current !== null) {
      return;
    }

    prevRunIdRef.current = currentRunId;
    prevVersionIdRef.current = versionId;

    if (runIdChanged) {
      preservedExecutionStateRef.current = null;
      setExecutionDirty(false);
    }

    const loadVersionForRun = async () => {
      latestTargetRunIdRef.current = targetRunId;
      let runToUse = run;
      if (!runToUse && targetRunId) {
        try {
          const runDetails = await api.executions.getRun(targetRunId);
          if (latestTargetRunIdRef.current !== targetRunId) return;
          runToUse = normalizeRunSummary(runDetails);
          upsertRun(runToUse);
        } catch (error) {
          if (latestTargetRunIdRef.current !== targetRunId) return;
          console.error('[VersionLoad] Failed to fetch run details:', error);
          if (designSavedSnapshotRef.current) {
            const savedNodes = cloneNodes(designSavedSnapshotRef.current.nodes);
            const savedEdges = cloneEdges(designSavedSnapshotRef.current.edges);
            const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
            setExecutionNodes([...savedNodes, ...terminalNodes]);
            setExecutionEdges(savedEdges);
            executionLoadedSnapshotRef.current = {
              nodes: cloneNodes(savedNodes),
              edges: cloneEdges(savedEdges),
            };
          }
          return;
        }
      }

      // If the cached run is missing version info, fetch the full details before deciding how to load
      if (runToUse && !runToUse.workflowVersionId && targetRunId) {
        try {
          const runDetails = await api.executions.getRun(targetRunId);
          if (latestTargetRunIdRef.current !== targetRunId) return;
          runToUse = normalizeRunSummary(runDetails);
          upsertRun(runToUse);
        } catch (error) {
          if (latestTargetRunIdRef.current !== targetRunId) return;
          console.error('[VersionLoad] Failed to fetch run details for version resolution:', error);
        }
      }

      if (!runToUse || latestTargetRunIdRef.current !== targetRunId) return;

      const actualVersionId = runToUse.workflowVersionId;

      if (!actualVersionId || actualVersionId === metadata.currentVersionId) {
        preservedExecutionStateRef.current = null;
        setExecutionDirty(false);

        if (designSavedSnapshotRef.current) {
          const savedNodes = cloneNodes(designSavedSnapshotRef.current.nodes);
          const savedEdges = cloneEdges(designSavedSnapshotRef.current.edges);
          const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
          setExecutionNodes([...savedNodes, ...terminalNodes]);
          setExecutionEdges(savedEdges);
          executionLoadedSnapshotRef.current = {
            nodes: cloneNodes(savedNodes),
            edges: cloneEdges(savedEdges),
          };
        } else {
          const designNodesCopy = cloneNodes(designNodesRef.current);
          const designEdgesCopy = cloneEdges(designEdgesRef.current);
          const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
          setExecutionNodes([...designNodesCopy, ...terminalNodes]);
          setExecutionEdges(designEdgesCopy);
          executionLoadedSnapshotRef.current = {
            nodes: cloneNodes(designNodesCopy),
            edges: cloneEdges(designEdgesCopy),
          };
        }

        if (historicalVersionId) {
          setHistoricalVersionId(null);
        }
        return;
      }

      if (actualVersionId === historicalVersionId) {
        return;
      }

      preservedExecutionStateRef.current = null;
      setExecutionDirty(false);

      try {
        const workflowIdForRun = runToUse.workflowId ?? metadata.id;
        if (!workflowIdForRun) {
          return;
        }

        const version = await api.workflows.getVersion(workflowIdForRun, actualVersionId);
        if (latestTargetRunIdRef.current !== targetRunId) return;

        const versionNodes = deserializeNodes(version);
        const versionEdges = deserializeEdges(version);
        const terminalNodes = executionNodesRef.current.filter((n) => n.type === 'terminal');
        setExecutionNodes([...versionNodes, ...terminalNodes]);
        setExecutionEdges(versionEdges);
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(versionNodes),
          edges: cloneEdges(versionEdges),
        };
        setHistoricalVersionId(actualVersionId);
      } catch (error) {
        if (latestTargetRunIdRef.current !== targetRunId) return;
        console.error('[VersionLoad] Failed to load workflow version:', error);
        toast({
          variant: 'destructive',
          title: 'Failed to load workflow version',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    void loadVersionForRun();

    return () => {
      // Keep latestTargetRunIdRef for guarding async responses; it will be overwritten on next run evaluation.
    };
  }, [
    mode,
    metadata.id,
    metadata.currentVersionId,
    workflowRuns,
    selectedRunId,
    mostRecentRunId,
    historicalVersionId,
    routeRunId,
    designSavedSnapshotRef,
    designNodesRef,
    designEdgesRef,
    executionNodesRef,
    executionEdgesRef,
    setExecutionNodes,
    setExecutionEdges,
    executionLoadedSnapshotRef,
    preservedExecutionStateRef,
    setExecutionDirty,
    getRunById,
    upsertRun,
    toast,
  ]);

  return {
    mostRecentRunId,
    fetchRuns,
    resetHistoricalTracking,
  };
}
