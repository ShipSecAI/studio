import { getNodeVisual } from './nodeTypeVisuals';

interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

interface WorkflowGraphSvgProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  className?: string;
}

const NODE_RADIUS = 10;
const PADDING = 40;

export function WorkflowGraphSvg({ nodes, edges, className }: WorkflowGraphSvgProps) {
  if (nodes.length === 0) return null;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Compute bounding box
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x);
    maxY = Math.max(maxY, n.position.y);
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;

  // Enforce minimum Y range to avoid thin horizontal strips.
  // Target ~40% of X range so the graph fills a 16:9 card nicely.
  const minYRange = rangeX * 0.4;
  if (rangeY < minYRange) {
    const centerY = (minY + maxY) / 2;
    minY = centerY - minYRange / 2;
    maxY = centerY + minYRange / 2;
  }

  const vbX = minX - PADDING;
  const vbY = minY - PADDING;
  const vbW = Math.max(maxX - minX + PADDING * 2, 1);
  const vbH = Math.max(maxY - minY + PADDING * 2, 1);

  // Scale stroke width relative to viewBox so edges stay visible
  const strokeWidth = Math.max(vbW, vbH) * 0.008;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Edges */}
      {edges.map((e) => {
        const src = nodeMap.get(e.source);
        const tgt = nodeMap.get(e.target);
        if (!src || !tgt) return null;

        const sx = src.position.x;
        const sy = src.position.y;
        const tx = tgt.position.x;
        const ty = tgt.position.y;
        const midX = (sx + tx) / 2;

        return (
          <path
            key={e.id}
            d={`M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={strokeWidth}
            opacity={0.6}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const visual = getNodeVisual(n.type);
        return (
          <circle
            key={n.id}
            cx={n.position.x}
            cy={n.position.y}
            r={NODE_RADIUS}
            fill={visual.color}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
