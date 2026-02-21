import { useMemo } from 'react';

interface WorkflowPreviewProps {
  graph?: Record<string, unknown>;
  className?: string;
}

const NODE_W = 160;
const NODE_H = 52;
const HEADER_H = 24;
const PAD = 40;

/**
 * Renders a miniature SVG preview of a workflow graph.
 * Card-style nodes matching the real workflow builder look.
 * Pure SVG — no React Flow dependency, instant render, zero overhead.
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

    // Generate bezier edge paths (from right-center of source to left-center of target)
    const edgePaths = edges
      .map((edge: any) => {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) return null;

        const sx = s.x + NODE_W;
        const sy = s.y + NODE_H / 2;
        const tx = t.x;
        const ty = t.y + NODE_H / 2;
        const dx = Math.max(Math.abs(tx - sx) * 0.4, 40);

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
          <path d="M 0 1 L 8 5 L 0 9 z" style={{ fill: 'hsl(var(--muted-foreground) / 0.4)' }} />
        </marker>
        <filter id="preview-node-shadow" x="-6%" y="-10%" width="112%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.10)" />
        </filter>
      </defs>

      {/* Edges */}
      {edgePaths.map((edge: any) => (
        <path
          key={edge.key}
          d={edge.d}
          fill="none"
          style={{ stroke: 'hsl(var(--muted-foreground) / 0.25)' }}
          strokeWidth={2}
          strokeLinecap="round"
          markerEnd="url(#preview-arrow)"
        />
      ))}

      {/* Nodes — card style matching the real workflow builder */}
      {positioned.map((node) => {
        const truncLabel =
          node.label.length > 18 ? node.label.substring(0, 18) + '\u2026' : node.label;

        return (
          <g key={node.id} filter="url(#preview-node-shadow)">
            {/* Card body */}
            <rect
              x={node.x}
              y={node.y}
              width={NODE_W}
              height={NODE_H}
              rx={node.isEntry ? 20 : 8}
              ry={node.isEntry ? 20 : 8}
              style={{
                fill: 'hsl(var(--card))',
                stroke: 'hsl(var(--border))',
              }}
              strokeWidth={1.5}
            />

            {/* Header band */}
            <clipPath id={`clip-${node.id}`}>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={HEADER_H}
                rx={node.isEntry ? 20 : 8}
                ry={node.isEntry ? 20 : 8}
              />
              {/* Fill the bottom corners of the header so the clip is rectangular at bottom */}
              <rect x={node.x} y={node.y + HEADER_H - 8} width={NODE_W} height={8} />
            </clipPath>
            <rect
              x={node.x}
              y={node.y}
              width={NODE_W}
              height={HEADER_H}
              clipPath={`url(#clip-${node.id})`}
              style={{
                fill: node.isEntry ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--muted) / 0.5)',
              }}
            />

            {/* Header separator line */}
            <line
              x1={node.x}
              y1={node.y + HEADER_H}
              x2={node.x + NODE_W}
              y2={node.y + HEADER_H}
              style={{ stroke: 'hsl(var(--border) / 0.5)' }}
              strokeWidth={1}
            />

            {/* Icon circle */}
            <circle
              cx={node.x + 14}
              cy={node.y + HEADER_H / 2}
              r={5.5}
              style={{
                fill: node.isEntry
                  ? 'hsl(var(--primary) / 0.15)'
                  : 'hsl(var(--muted-foreground) / 0.1)',
                stroke: node.isEntry
                  ? 'hsl(var(--primary) / 0.4)'
                  : 'hsl(var(--muted-foreground) / 0.25)',
              }}
              strokeWidth={1}
            />

            {/* Label text in header */}
            <text
              x={node.x + 24}
              y={node.y + HEADER_H / 2 + 4}
              style={{
                fill: 'hsl(var(--foreground))',
                fontSize: 10,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: 600,
              }}
            >
              {truncLabel}
            </text>

            {/* Subtitle "component" in body */}
            <text
              x={node.x + 14}
              y={node.y + HEADER_H + (NODE_H - HEADER_H) / 2 + 4}
              style={{
                fill: 'hsl(var(--muted-foreground) / 0.6)',
                fontSize: 8.5,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: 400,
              }}
            >
              component
            </text>

            {/* Right-side port dot */}
            <circle
              cx={node.x + NODE_W}
              cy={node.y + NODE_H / 2}
              r={3.5}
              style={{
                fill: node.isEntry ? 'hsl(var(--primary) / 0.6)' : 'hsl(142 76% 36% / 0.6)',
                stroke: 'hsl(var(--card))',
              }}
              strokeWidth={1.5}
            />

            {/* Left-side port dot (skip for entry) */}
            {!node.isEntry && (
              <circle
                cx={node.x}
                cy={node.y + NODE_H / 2}
                r={3.5}
                style={{
                  fill: 'hsl(217 91% 60% / 0.6)',
                  stroke: 'hsl(var(--card))',
                }}
                strokeWidth={1.5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
