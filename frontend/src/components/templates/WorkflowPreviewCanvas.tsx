import { useEffect, useMemo } from 'react';
import ReactFlow, { ReactFlowProvider, Background, useReactFlow } from 'reactflow';
import type { Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { PreviewNode } from './PreviewNode';

interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data?: { label?: string; config?: unknown };
}

interface TemplateEdge {
  id: string;
  source: string;
  target: string;
}

interface WorkflowPreviewCanvasProps {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
  className?: string;
}

const nodeTypes = { preview: PreviewNode };

const FIT_VIEW_OPTIONS = { padding: 0.15, duration: 0 };

function PreviewFlow({ nodes, edges, className }: WorkflowPreviewCanvasProps) {
  const { fitView } = useReactFlow();

  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'preview',
        position: n.position,
        data: { nodeType: n.type, label: n.data?.label },
        draggable: false,
        selectable: false,
        connectable: false,
      })),
    [nodes],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        style: { stroke: '#94a3b8', strokeWidth: 1.5 },
        animated: false,
      })),
    [edges],
  );

  // Re-fit after dialog animation completes and nodes are measured
  useEffect(() => {
    // Multiple attempts to handle dialog open animation timing
    const t1 = setTimeout(() => fitView(FIT_VIEW_OPTIONS), 100);
    const t2 = setTimeout(() => fitView(FIT_VIEW_OPTIONS), 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [fitView, nodes]);

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        preventScrolling
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
      </ReactFlow>
    </div>
  );
}

export function WorkflowPreviewCanvas(props: WorkflowPreviewCanvasProps) {
  return (
    <ReactFlowProvider>
      <PreviewFlow {...props} />
    </ReactFlowProvider>
  );
}
