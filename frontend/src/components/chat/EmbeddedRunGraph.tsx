import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
} from 'reactflow';
import { WorkflowExecutionPane } from '@/features/workflow-builder/components/WorkflowExecutionPane';
import { useWorkflow } from '@/hooks/queries/useWorkflowQueries';
import { deserializeNodes, deserializeEdges } from '@/utils/workflowSerializer';
import type { FrontendNodeData } from '@/schemas/node';
import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';

interface EmbeddedRunGraphProps {
  workflowId: string;
  runId: string;
}

function EmbeddedRunGraphCanvas({ workflowId, runId }: EmbeddedRunGraphProps) {
  const { data: workflow, isLoading, isError } = useWorkflow(workflowId);
  const monitorRun = useExecutionStore((state) => state.monitorRun);
  const stopPolling = useExecutionStore((state) => state.stopPolling);
  const setMode = useWorkflowUiStore((state) => state.setMode);

  const [nodes, setNodes] = useState<ReactFlowNode<FrontendNodeData>[]>([]);
  const [edges, setEdges] = useState<ReactFlowEdge[]>([]);

  useEffect(() => {
    // Force execution rendering behavior for the shared canvas node components.
    setMode('execution');
    monitorRun(runId, workflowId);
    // Capture runId in closure so cleanup checks the value from THIS effect instance
    const startedRunId = runId;
    return () => {
      const currentRunId = useExecutionStore.getState().runId;
      if (currentRunId === startedRunId) {
        stopPolling();
      }
    };
  }, [setMode, monitorRun, runId, workflowId, stopPolling]);

  useEffect(() => {
    if (!workflow) return;
    setNodes(deserializeNodes(workflow));
    setEdges(deserializeEdges(workflow));
  }, [workflow]);

  const onNodesChange = useMemo(
    () => (changes: any[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
    },
    [],
  );

  const onEdgesChange = useMemo(
    () => (changes: any[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading graph...
      </div>
    );
  }

  if (isError || !workflow) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        Unable to load workflow graph.
      </div>
    );
  }

  return (
    <WorkflowExecutionPane
      workflowId={workflowId}
      nodes={nodes}
      edges={edges}
      setNodes={setNodes}
      setEdges={setEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
    />
  );
}

export function EmbeddedRunGraph(props: EmbeddedRunGraphProps) {
  return (
    <ReactFlowProvider>
      <EmbeddedRunGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
