import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTemporalStore, useWorkflowHistoryStore } from '@/store/workflowHistoryStore'
import { getGraphChangeDescription } from '@/utils/graphDiff'
import { cn } from '@/lib/utils'

export function HistoryDebugger() {
    const { pastStates, futureStates } = useTemporalStore(state => state)
    const { nodes: currentNodes, edges: currentEdges } = useWorkflowHistoryStore(state => state)

    // Dragging state
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const isDraggingRef = useRef(false)
    const dragStartRef = useRef({ x: 0, y: 0 })
    const positionStartRef = useRef({ x: 0, y: 0 })

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true
        dragStartRef.current = { x: e.clientX, y: e.clientY }
        positionStartRef.current = { ...position }

        // Prevent default text selection
        e.preventDefault()
    }, [position])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) return

            const dx = e.clientX - dragStartRef.current.x
            const dy = e.clientY - dragStartRef.current.y

            setPosition({
                x: positionStartRef.current.x + dx,
                y: positionStartRef.current.y + dy
            })
        }

        const handleMouseUp = () => {
            isDraggingRef.current = false
        }

        if (isDraggingRef.current) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)
        }

        // Always add listeners to window to catch releases outside the element
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [])

    const historyItems = useMemo(() => {
        // We want to visualize the stack as a timeline.
        // Past states: [State 0, State 1, State 2] -> Current State -> Future States [State 4, State 5]
        // The "Action" is the transition between states.

        // We need to compare State[i] with State[i+1].
        // Let's reconstruct the sequence.
        // futureStates is a stack (last item is next state), so we reverse it for chronological order
        const allStates = [...pastStates, { nodes: currentNodes, edges: currentEdges }, ...[...futureStates].reverse()]

        // Items represent transitions (actions)
        const items = []

        // Initial state (empty) -> first past state? 
        // Or just diff between adjacent states.
        if (allStates.length === 0) return []

        for (let i = 0; i < allStates.length; i++) {
            const state = allStates[i]
            const prevState = i === 0 ? { nodes: [], edges: [] } : allStates[i - 1]

            // Skip comparing first state to empty if first state is initial load (might be noisy)
            // But let's show it.
            const description = getGraphChangeDescription(prevState, state)

            let status: 'past' | 'current' | 'future' = 'past'
            if (i < pastStates.length) status = 'past'
            else if (i === pastStates.length) status = 'current' // This is the transition TO current
            else status = 'future'

            items.push({
                index: i,
                description,
                status,
                nodeCount: state.nodes?.length ?? 0,
                edgeCount: state.edges?.length ?? 0
            })
        }

        return items.reverse() // Show newest at top
    }, [pastStates, futureStates, currentNodes, currentEdges])

    return (
        <Card
            className="fixed bottom-4 right-4 w-80 max-h-[500px] shadow-xl z-50 bg-background/95 backdrop-blur border-border flex flex-col transition-shadow hover:shadow-2xl"
            style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        >
            <CardHeader
                className="py-3 px-4 border-b bg-muted/50 flex-shrink-0 cursor-move select-none active:bg-muted/70 transition-colors"
                onMouseDown={handleMouseDown}
            >
                <CardTitle className="text-sm font-semibold flex justify-between items-center">
                    Undo/Redo Stack
                    <span className="text-xs font-normal text-muted-foreground">({pastStates.length} undo / {futureStates.length} redo)</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden flex-1">
                <div className="h-full overflow-y-auto max-h-[300px]">
                    <div className="flex flex-col p-2 gap-1">
                        {historyItems.map((item) => (
                            <div
                                key={item.index}
                                className={cn(
                                    "text-xs p-2 rounded border flex flex-col gap-1",
                                    item.status === 'current' ? "bg-primary/10 border-primary/50" :
                                        item.status === 'future' ? "bg-muted/30 opacity-60 dashed border-muted-foreground/30" :
                                            "bg-card hover:bg-muted/50"
                                )}
                            >
                                <div className="flex justify-between items-center font-medium">
                                    <span className="flex items-center">
                                        {item.status === 'current' && (
                                            <span className="mr-2 text-[8px] bg-primary text-primary-foreground px-1 py-0.5 rounded uppercase tracking-wider font-bold">
                                                NOW
                                            </span>
                                        )}
                                        {item.description}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground ml-2">
                                        #{item.index}
                                    </span>
                                </div>
                                <div className="text-[10px] text-muted-foreground flex gap-3">
                                    <span>Nodes: {item.nodeCount}</span>
                                    <span>Edges: {item.edgeCount}</span>
                                </div>
                            </div>
                        ))}

                        {historyItems.length === 0 && (
                            <div className="text-center p-4 text-xs text-muted-foreground">No history recorded</div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
