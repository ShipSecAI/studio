import { useMemo } from 'react';

interface WorkflowPreviewProps {
  graph?: Record<string, unknown>;
  className?: string;
}

/**
 * Renders a miniature SVG preview of a workflow graph.
 * Uses inline SVG for instant rendering, dark mode support, and zero performance overhead.
 */
export function WorkflowPreview({ graph, className }: WorkflowPreviewProps) {
  const svgContent = useMemo(() => {
    const graphData = graph as any;
    const rawNodes: any[] = graphData?.nodes || [];
    const rawEdges: any[] = graphData?.edges || [];

    // Filter out terminal nodes
    const nodes = rawNodes.filter((n) => n.type !== 'terminal');
    if (nodes.length === 0) return null;

    const edges = rawEdges.filter((e) => {
      return nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target);
    });

    const NODE_W = 120;
    const NODE_H = 36;
    const PAD = 40;

    // Calculate bounding box from node positions
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const positioned = nodes.map((node) => {
      const x = node.position?.x ?? 0;
      const y = node.position?.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);

      const slug = node.data?.componentId ?? node.data?.componentSlug ?? '';
      const isEntry =
        slug === 'core.workflow.entrypoint' ||
        slug === 'entry-point' ||
        slug === 'core.workflow.entryPoint';

      return {
        id: node.id,
        x,
        y,
        label: node.data?.label || 'Node',
        isEntry,
      };
    });

    const vbW = maxX - minX + PAD * 2;
    const vbH = maxY - minY + PAD * 2;
    const viewBox = `${minX - PAD} ${minY - PAD} ${vbW} ${vbH}`;

    // Map for quick lookup
    const nodeMap = new Map(positioned.map((n) => [n.id, n]));

    // Generate bezier edge paths
    const edgePaths = edges
      .map((edge: any) => {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) return null;

        const sx = s.x + NODE_W;
        const sy = s.y + NODE_H / 2;
        const tx = t.x;
        const ty = t.y + NODE_H / 2;
        const dx = Math.max(Math.abs(tx - sx) * 0.4, 30);

        return {
          key: edge.id || `${edge.source}-${edge.target}`,
          d: `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`,
        };
      })
      .filter(Boolean);

    return { viewBox, positioned, edgePaths };
  }, [graph]);

  if (!svgContent) return null;

  const { viewBox, positioned, edgePaths } = svgContent;

  return (
    <svg
      viewBox={viewBox}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="preview-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" style={{ fill: 'hsl(var(--muted-foreground) / 0.35)' }} />
        </marker>
        <filter id="preview-node-shadow" x="-8%" y="-8%" width="116%" height="125%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.06)" />
        </filter>
      </defs>

      {/* Edges */}
      {edgePaths.map((edge: any) => (
        <path
          key={edge.key}
          d={edge.d}
          fill="none"
          style={{ stroke: 'hsl(var(--muted-foreground) / 0.2)' }}
          strokeWidth={2}
          strokeLinecap="round"
          markerEnd="url(#preview-arrow)"
        />
      ))}

      {/* Nodes */}
      {positioned.map((node) => (
        <g key={node.id} filter="url(#preview-node-shadow)">
          <rect
            x={node.x}
            y={node.y}
            width={120}
            height={36}
            rx={node.isEntry ? 18 : 8}
            ry={node.isEntry ? 18 : 8}
            style={{
              fill: node.isEntry ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--card))',
              stroke: node.isEntry ? 'hsl(var(--primary) / 0.35)' : 'hsl(var(--border))',
            }}
            strokeWidth={1.5}
          />
          <text
            x={node.x + 60}
            y={node.y + 22}
            textAnchor="middle"
            style={{
              fill: node.isEntry ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
              fontSize: 11,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontWeight: 500,
            }}
          >
            {node.label.length > 14 ? node.label.substring(0, 14) + '\u2026' : node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
