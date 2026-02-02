import type { Node, Edge } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';

interface GraphState {
  nodes: Node<FrontendNodeData>[];
  edges: Edge[];
}

const areObjectsEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

export function getGraphChangeDescription(
  prev: Partial<GraphState>,
  next: Partial<GraphState>,
): string {
  if (!prev && !next) return 'No state';
  if (!prev || !prev.nodes) return 'Initial state';
  // If next is empty/undefined, it's weird but possible
  if (!next || !next.nodes) return 'State cleared';

  const prevNodes = prev.nodes || [];
  const nextNodes = next.nodes || [];
  const prevEdges = prev.edges || [];
  const nextEdges = next.edges || [];

  const changes: string[] = [];

  // compare nodes
  const prevNodesMap = new Map(prevNodes.map((n) => [n.id, n]));
  const nextNodesMap = new Map(nextNodes.map((n) => [n.id, n]));

  const addedNodes = nextNodes.filter((n) => !prevNodesMap.has(n.id));
  const removedNodes = prevNodes.filter((n) => !nextNodesMap.has(n.id));

  const modifiedNodes = nextNodes.filter((n) => {
    const p = prevNodesMap.get(n.id);
    if (!p) return false;

    const posChanged =
      Math.round(p.position.x) !== Math.round(n.position.x) ||
      Math.round(p.position.y) !== Math.round(n.position.y);

    // Simple deep compare for debug purposes
    const dataChanged = !areObjectsEqual(p.data, n.data);
    return posChanged || dataChanged;
  });

  // Detailed logic
  if (addedNodes.length > 0) {
    if (addedNodes.length === 1) {
      const label = addedNodes[0].data?.label || addedNodes[0].id;
      changes.push(`Added node "${label}"`);
    } else {
      changes.push(`Added ${addedNodes.length} nodes`);
    }
  }

  if (removedNodes.length > 0) {
    if (removedNodes.length === 1) {
      const label = removedNodes[0].data?.label || removedNodes[0].id;
      changes.push(`Deleted node "${label}"`);
    } else {
      changes.push(`Deleted ${removedNodes.length} nodes`);
    }
  }

  if (modifiedNodes.length > 0) {
    // Distinguish between move and config
    const moved = modifiedNodes.filter((n) => {
      const p = prevNodesMap.get(n.id);
      if (!p) return false;
      return (
        Math.round(p.position.x) !== Math.round(n.position.x) ||
        Math.round(p.position.y) !== Math.round(n.position.y)
      );
    });
    const configured = modifiedNodes.filter((n) => {
      const p = prevNodesMap.get(n.id);
      if (!p) return false;
      return !areObjectsEqual(p.data, n.data);
    });

    if (moved.length > 0) {
      if (moved.length === 1) {
        changes.push(`Moved node "${moved[0].data?.label || moved[0].id}"`);
      } else {
        changes.push(`Moved ${moved.length} nodes`);
      }
    }

    if (configured.length > 0) {
      if (configured.length === 1) {
        changes.push(`Updated config for "${configured[0].data?.label || configured[0].id}"`);
      } else {
        changes.push(`Updated config for ${configured.length} nodes`);
      }
    }
  }

  // Edges
  const prevEdgesIds = new Set(prevEdges.map((e) => e.id));
  const nextEdgesIds = new Set(nextEdges.map((e) => e.id));

  const addedEdges = nextEdges.filter((e) => !prevEdgesIds.has(e.id));
  const removedEdges = prevEdges.filter((e) => !nextEdgesIds.has(e.id));

  if (addedEdges.length > 0) changes.push(`Added ${addedEdges.length} connection(s)`);
  if (removedEdges.length > 0) changes.push(`Removed ${removedEdges.length} connection(s)`);

  if (changes.length === 0) return 'No visible changes';

  return changes.join(', ');
}
