import { useEffect, useState } from 'react'
import { api } from '@/services/api'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MessageModal } from '@/components/ui/MessageModal'

interface NodeIO {
    nodeRef: string
    componentId: string
    status: 'running' | 'completed' | 'failed' | 'skipped'
    startedAt: string | null
    completedAt: string | null
    durationMs: number | null
    inputs: any | null
    outputs: any | null
    inputsSize: number
    outputsSize: number
    inputsSpilled: boolean
    outputsSpilled: boolean
    inputsTruncated: boolean
    outputsTruncated: boolean
    errorMessage: string | null
}

export function NodeIOInspector() {
    const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId)
    const selectedNodeId = useExecutionTimelineStore((state) => state.selectedNodeId)

    const [loading, setLoading] = useState(false)
    const [loadingDetail, setLoadingDetail] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [nodeIOList, setNodeIOList] = useState<NodeIO[]>([])
    const [selectedNodeIO, setSelectedNodeIO] = useState<NodeIO | null>(null)
    const [fullViewModal, setFullViewModal] = useState<{ open: boolean; title: string; content: string }>({
        open: false,
        title: '',
        content: '',
    })

    useEffect(() => {
        if (!selectedRunId) {
            setNodeIOList([])
            return
        }

        const fetchNodeIO = async () => {
            setLoading(true)
            setError(null)
            try {
                const data = await api.executions.listNodeIO(selectedRunId)
                // Cast the API response to match our interface, ensuring required fields are present
                const nodes = (data.nodes || []).map((n: any) => ({
                    ...n,
                    nodeRef: n.nodeRef || 'unknown',
                    componentId: n.componentId || 'unknown',
                    status: n.status || 'running',
                    startedAt: n.startedAt || null,
                    completedAt: n.completedAt || null,
                    durationMs: n.durationMs ?? null,
                    inputs: n.inputs || null,
                    outputs: n.outputs || null,
                    inputsTruncated: !!n.inputsTruncated,
                    outputsTruncated: !!n.outputsTruncated,
                    errorMessage: n.errorMessage || null,
                })) as NodeIO[]
                setNodeIOList(nodes)
            } catch (err: any) {
                setError(err.message || 'Failed to fetch node I/O')
            } finally {
                setLoading(false)
            }
        }

        fetchNodeIO()
    }, [selectedRunId])

    useEffect(() => {
        if (selectedNodeId) {
            const found = nodeIOList.find(n => n.nodeRef === selectedNodeId)
            if (found) {
                setSelectedNodeIO(found)
            } else if (selectedRunId) {
                // Might need a direct fetch if not in the list for some reason
                const fetchDetail = async () => {
                    try {
                        const detail: any = await api.executions.getNodeIO(selectedRunId, selectedNodeId)
                        setSelectedNodeIO({
                            ...detail,
                            nodeRef: detail.nodeRef || selectedNodeId,
                            componentId: detail.componentId || 'unknown',
                            status: detail.status || 'running',
                            startedAt: detail.startedAt || null,
                            completedAt: detail.completedAt || null,
                            durationMs: detail.durationMs ?? null,
                            inputs: detail.inputs || null,
                            outputs: detail.outputs || null,
                            errorMessage: detail.errorMessage || null,
                        } as NodeIO)
                    } catch (err) {
                        setSelectedNodeIO(null)
                    }
                }
                fetchDetail()
            }
        } else {
            setSelectedNodeIO(null)
        }
    }, [selectedNodeId, nodeIOList, selectedRunId])

    if (!selectedRunId) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                Select a run to view I/O
            </div>
        )
    }

    if (loading && nodeIOList.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                <AlertCircle className="h-8 w-8 text-destructive mb-2" />
                <p className="text-sm font-medium">{error}</p>
            </div>
        )
    }

    const renderJson = (data: any) => {
        if (data === null || data === undefined) {
            return <span className="text-muted-foreground italic text-[11px]">Empty</span>
        }

        let content = '';
        if (typeof data === 'string') {
            content = data;
        } else if (Object.keys(data).length === 0) {
            return <span className="text-muted-foreground italic text-[11px]">Empty</span>
        } else {
            content = JSON.stringify(data, null, 2);
        }

        return (
            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/20 text-foreground p-3 rounded-md border border-border shadow-sm min-h-[40px] max-h-[300px] overflow-y-auto">
                {content}
            </pre>
        )
    }

    const fetchFullNodeIO = async (type: 'inputs' | 'outputs') => {
        if (!selectedRunId || !selectedNodeId) return
        setLoadingDetail(true)
        try {
            const detail: any = await api.executions.getNodeIO(selectedRunId, selectedNodeId, true)
            const data = type === 'inputs' ? detail.inputs : detail.outputs
            const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)

            setFullViewModal({
                open: true,
                title: `Full ${type === 'inputs' ? 'Inputs' : 'Outputs'} - ${selectedNodeId}`,
                content,
            })
        } catch (err: any) {
            console.error('Failed to fetch full node I/O', err)
        } finally {
            setLoadingDetail(false)
        }
    }

    const renderNodeIO = (io: NodeIO) => (
        <div key={io.nodeRef} className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                        {io.nodeRef}
                    </Badge>
                    <span className="text-xs font-semibold">{io.componentId}</span>
                </div>
                <div className="flex items-center gap-2">
                    {io.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {io.status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
                    {io.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                    <span className="text-[11px] capitalize">{io.status}</span>
                </div>
            </div>

            {io.errorMessage && (
                <div className="p-2 border border-destructive/20 bg-destructive/5 rounded text-[11px] text-destructive">
                    {io.errorMessage}
                </div>
            )}

            <div className="flex flex-col gap-6">
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Inputs</span>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                                {Math.round(io.inputsSize / 1024 * 10) / 10} KB
                            </span>
                            {io.inputsTruncated && (
                                <button
                                    onClick={() => fetchFullNodeIO('inputs')}
                                    disabled={loadingDetail}
                                    className="text-[10px] text-primary hover:text-primary/80 font-medium disabled:text-muted-foreground px-1.5 py-0.5 rounded bg-primary/5 hover:bg-primary/10 transition-colors"
                                >
                                    {loadingDetail ? 'Loading...' : 'View Full'}
                                </button>
                            )}
                        </div>
                    </div>
                    {renderJson(io.inputs)}
                </div>
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Outputs</span>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                                {Math.round(io.outputsSize / 1024 * 10) / 10} KB
                            </span>
                            {io.outputsTruncated && (
                                <button
                                    onClick={() => fetchFullNodeIO('outputs')}
                                    disabled={loadingDetail}
                                    className="text-[10px] text-primary hover:text-primary/80 font-medium disabled:text-muted-foreground px-1.5 py-0.5 rounded bg-primary/5 hover:bg-primary/10 transition-colors"
                                >
                                    {loadingDetail ? 'Loading...' : 'View Full'}
                                </button>
                            )}
                        </div>
                    </div>
                    {renderJson(io.outputs)}
                </div>
            </div>

            <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-2 border-t">
                {io.startedAt && (
                    <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Started: {new Date(io.startedAt).toLocaleTimeString()}
                    </div>
                )}
                {io.durationMs !== null && (
                    <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Duration: {Math.round(io.durationMs)}ms
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <div className="h-full overflow-y-auto">
            <div className="p-4 space-y-6">
                {selectedNodeIO ? (
                    <div>
                        <button
                            onClick={() => useExecutionTimelineStore.getState().selectNode(null)}
                            className="mb-4 text-[11px] text-blue-500 hover:underline flex items-center gap-1"
                        >
                            ← Back to summary
                        </button>
                        {renderNodeIO(selectedNodeIO)}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                            All Nodes I/O Summary
                        </div>
                        {nodeIOList.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-8 text-center">
                                No node I/O recorded for this run yet.
                            </div>
                        ) : (
                            <div className="grid gap-2">
                                {nodeIOList.map((io) => (
                                    <Card
                                        key={io.nodeRef}
                                        className={cn(
                                            "p-3 cursor-pointer hover:bg-muted/50 transition-colors",
                                            selectedNodeId === io.nodeRef && "border-primary bg-primary/5"
                                        )}
                                        onClick={() => useExecutionTimelineStore.getState().selectNode(io.nodeRef)}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono font-bold">{io.nodeRef}</span>
                                                <span className="text-[11px] text-muted-foreground">{io.componentId}</span>
                                            </div>
                                            <Badge
                                                variant={io.status === 'completed' ? 'outline' : io.status === 'failed' ? 'destructive' : 'secondary'}
                                                className="text-[9px] h-4 px-1.5"
                                            >
                                                {io.status}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-4 text-[10px]">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-muted-foreground">In:</span>
                                                <span>{Math.round(io.inputsSize / 1024 * 10) / 10} KB</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-muted-foreground">Out:</span>
                                                <span>{Math.round(io.outputsSize / 1024 * 10) / 10} KB</span>
                                            </div>
                                            {io.durationMs !== null && (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-muted-foreground">Time:</span>
                                                    <span>{Math.round(io.durationMs)}ms</span>
                                                </div>
                                            )}
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <MessageModal
                open={fullViewModal.open}
                onOpenChange={(open) => setFullViewModal(prev => ({ ...prev, open }))}
                title={fullViewModal.title}
                message={fullViewModal.content}
            />
        </div>
    )
}
