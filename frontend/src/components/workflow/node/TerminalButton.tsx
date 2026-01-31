import { useEffect, useRef } from 'react';
import { type Node, useReactFlow } from 'reactflow';
import { Terminal as TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TERMINAL_DIMENSIONS } from './constants';
import type { TerminalButtonProps } from './types';

/**
 * Terminal button with portal-based panel rendering.
 * Creates a terminal node in ReactFlow canvas that follows the parent node.
 */
export function TerminalButton({
  id,
  isTerminalOpen,
  setIsTerminalOpen,
  isTerminalLoading,
  terminalSession,
  selectedRunId,
  mode,
  playbackMode,
  isLiveFollowing,
  bringTerminalToFront,
}: TerminalButtonProps) {
  const { getNodes, setNodes } = useReactFlow();
  const terminalNodeId = `terminal-${id}`;
  const parentPositionRef = useRef<{ x: number; y: number; width: number } | null>(null);
  const terminalCreatedAtRef = useRef<number | null>(null);

  const { WIDTH: TERMINAL_WIDTH, HEIGHT: TERMINAL_HEIGHT, GAP: TERMINAL_GAP } = TERMINAL_DIMENSIONS;

  // Get parent node width from node data (simpler, more reliable)
  const getParentNodeWidth = (parentNode: Node): number => {
    const uiSize = (parentNode.data as any)?.ui?.size as { width?: number } | undefined;
    if (uiSize?.width) {
      return uiSize.width;
    }
    if ((parentNode as any).width) {
      return (parentNode as any).width;
    }
    const isEntryPoint = (parentNode.data as any)?.componentSlug === 'entry-point';
    return isEntryPoint ? 205 : 320;
  };

  // Calculate terminal position: render above parent, align right edges
  const calculateTerminalPosition = (parentNode: Node): { x: number; y: number } => {
    const parentWidth = getParentNodeWidth(parentNode);
    return {
      x: parentNode.position.x + parentWidth - TERMINAL_WIDTH,
      y: parentNode.position.y - TERMINAL_HEIGHT - TERMINAL_GAP,
    };
  };

  // Create or remove terminal node when isTerminalOpen changes
  useEffect(() => {
    if (!isTerminalOpen) {
      const nodes = getNodes();
      const terminalNode = nodes.find((n) => n.id === terminalNodeId);
      if (terminalNode) {
        setNodes((nds) => nds.filter((n) => n.id !== terminalNodeId));
      }
      parentPositionRef.current = null;
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const nodes = getNodes();
        const terminalNode = nodes.find((n) => n.id === terminalNodeId);
        const parentNode = nodes.find((n) => n.id === id);

        if (!parentNode) {
          return;
        }

        const parentWidth = getParentNodeWidth(parentNode);
        const expectedPosition = calculateTerminalPosition(parentNode);

        if (!terminalNode) {
          const newTerminalNode: Node = {
            id: terminalNodeId,
            type: 'terminal',
            position: expectedPosition,
            data: {
              parentNodeId: id,
              runId: selectedRunId,
              timelineSync: mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing),
              onClose: () => setIsTerminalOpen(false),
            },
            draggable: true,
            selectable: true,
          };
          setNodes((nds) => [...nds, newTerminalNode]);
          parentPositionRef.current = {
            x: parentNode.position.x,
            y: parentNode.position.y,
            width: parentWidth,
          };
          terminalCreatedAtRef.current = Date.now();
        } else {
          const needsDataUpdate =
            terminalNode.data.runId !== selectedRunId ||
            terminalNode.data.timelineSync !==
              (mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing));

          const lastPosition = parentPositionRef.current;
          const needsPositionUpdate =
            !lastPosition ||
            Math.abs(lastPosition.x - parentNode.position.x) > 1 ||
            Math.abs(lastPosition.y - parentNode.position.y) > 1 ||
            Math.abs(lastPosition.width - parentWidth) > 1 ||
            Math.abs(terminalNode.position.x - expectedPosition.x) > 1 ||
            Math.abs(terminalNode.position.y - expectedPosition.y) > 1;

          if (needsDataUpdate || needsPositionUpdate) {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === terminalNodeId
                  ? {
                      ...n,
                      position: needsPositionUpdate ? expectedPosition : n.position,
                      data: needsDataUpdate
                        ? {
                            ...n.data,
                            runId: selectedRunId,
                            timelineSync:
                              mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing),
                          }
                        : n.data,
                    }
                  : n,
              ),
            );
            if (needsPositionUpdate) {
              parentPositionRef.current = {
                x: parentNode.position.x,
                y: parentNode.position.y,
                width: parentWidth,
              };
            }
          }
        }
      });
    });
  }, [isTerminalOpen, id, selectedRunId, mode, playbackMode, isLiveFollowing, terminalNodeId]);

  // Periodically check if parent node moved or resized (for smooth following)
  useEffect(() => {
    if (!isTerminalOpen) {
      terminalCreatedAtRef.current = null;
      return;
    }

    const intervalId = setInterval(() => {
      if (terminalCreatedAtRef.current && Date.now() - terminalCreatedAtRef.current < 300) {
        return;
      }

      const nodes = getNodes();
      const parentNode = nodes.find((n) => n.id === id);
      const terminalNode = nodes.find((n) => n.id === terminalNodeId);

      if (parentNode && terminalNode) {
        const parentWidth = getParentNodeWidth(parentNode);
        const expectedPosition = calculateTerminalPosition(parentNode);

        const lastPosition = parentPositionRef.current;
        if (
          !lastPosition ||
          Math.abs(lastPosition.x - parentNode.position.x) > 1 ||
          Math.abs(lastPosition.y - parentNode.position.y) > 1 ||
          Math.abs(lastPosition.width - parentWidth) > 1 ||
          Math.abs(terminalNode.position.x - expectedPosition.x) > 1 ||
          Math.abs(terminalNode.position.y - expectedPosition.y) > 1
        ) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === terminalNodeId
                ? {
                    ...n,
                    position: expectedPosition,
                  }
                : n,
            ),
          );
          parentPositionRef.current = {
            x: parentNode.position.x,
            y: parentNode.position.y,
            width: parentWidth,
          };
        }
      }
    }, 100);

    return () => clearInterval(intervalId);
  }, [isTerminalOpen, id, terminalNodeId]);

  return (
    <div className="relative flex justify-center">
      <button
        type="button"
        onClick={() => {
          setIsTerminalOpen((prev) => !prev);
          bringTerminalToFront(id);
        }}
        className={cn(
          'flex items-center gap-1 rounded-full px-2 py-1 text-[11px] border transition-colors',
          isTerminalOpen
            ? 'bg-blue-600/15 text-blue-600 border-blue-400 shadow-sm ring-2 ring-blue-300/60'
            : 'bg-slate-900/60 text-slate-100 border-slate-700',
        )}
        title="Live Logs"
        aria-label="Live Logs"
      >
        <TerminalIcon className="h-3 w-3 text-current" />
        {isTerminalLoading && <span className="animate-pulse">…</span>}
        {!isTerminalLoading && terminalSession?.chunks?.length ? (
          <span className="w-2 h-2 rounded-full bg-green-400" />
        ) : null}
      </button>
    </div>
  );
}
