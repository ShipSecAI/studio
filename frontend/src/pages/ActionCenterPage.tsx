import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import {
    CheckCircle,
    XCircle,
    RefreshCw,
    Search,
    Clock,
    Zap,
    ExternalLink,
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { api } from '@/services/api'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { MarkdownView } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'



interface HumanInputRequest {
    id: string
    runId: string
    workflowId: string
    nodeRef: string
    status: 'pending' | 'resolved' | 'expired' | 'cancelled'
    inputType: string
    title: string
    description: string | null
    inputSchema: any | null
    context: Record<string, unknown> | null
    resolveToken: string
    timeoutAt: string | null
    respondedAt: string | null
    respondedBy: string | null
    responseData: Record<string, unknown> | null
    createdAt: string
    updatedAt: string
}

const STATUS_OPTIONS = [
    { value: 'all', label: 'All statuses' },
    { value: 'pending', label: 'Pending' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'expired', label: 'Expired' },
]

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    pending: 'default',
    approved: 'secondary',
    rejected: 'destructive',
    expired: 'outline',
    cancelled: 'outline',
}

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
    pending: Clock,
    approved: CheckCircle,
    rejected: XCircle,
    expired: Clock,
    cancelled: XCircle,
}

const formatDateTime = (value?: string | null) => {
    if (!value) return '—'
    const date = new Date(value)
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZoneName: 'short',
    }).format(date)
}

const formatRelativeTime = (value?: string | null) => {
    if (!value) return ''
    const date = new Date(value)
    const now = new Date()
    const diff = date.getTime() - now.getTime()

    if (diff < 0) return 'Expired'

    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 24) {
        const days = Math.floor(hours / 24)
        return `${days}d ${hours % 24}h left`
    }
    if (hours > 0) {
        return `${hours}h ${minutes}m left`
    }
    return `${minutes}m left`
}

export function ActionCenterPage() {
    const { toast } = useToast()
    const [approvals, setApprovals] = useState<HumanInputRequest[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'resolved' | 'expired'>('pending')
    const [actionState, setActionState] = useState<Record<string, 'approve' | 'reject' | 'view'>>({})

    // Resolve dialog state
    const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
    const [resolveAction, setResolveAction] = useState<'approve' | 'reject' | 'view'>('approve')
    const [selectedApproval, setSelectedApproval] = useState<HumanInputRequest | null>(null)
    const [responseNote, setResponseNote] = useState('')
    const [formValues, setFormValues] = useState<Record<string, any>>({})
    const [selectedOptions, setSelectedOptions] = useState<string[]>([])

    const parsedInputSchema = useMemo(() => {
        if (!selectedApproval?.inputSchema) return null
        if (typeof selectedApproval.inputSchema === 'object') return selectedApproval.inputSchema
        try {
            return JSON.parse(selectedApproval.inputSchema)
        } catch (e) {
            console.error('Failed to parse inputSchema:', e)
            return null
        }
    }, [selectedApproval?.inputSchema])

    const fetchApprovals = async () => {
        setIsLoading(true)
        setError(null)
        try {
            const status = statusFilter === 'all' ? undefined : statusFilter
            const data = await api.humanInputs.list({ status })
            setApprovals(data as HumanInputRequest[])
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load approvals')
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchApprovals()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter])

    const filteredApprovals = useMemo(() => {
        const query = search.trim().toLowerCase()
        return approvals.filter((approval) => {
            const matchesSearch =
                query.length === 0 ||
                approval.title.toLowerCase().includes(query) ||
                approval.nodeRef.toLowerCase().includes(query) ||
                approval.runId.toLowerCase().includes(query)
            return matchesSearch
        })
    }, [search, approvals])

    const pendingCount = approvals.filter(a => a.status === 'pending').length

    const markAction = (id: string, action: 'approve' | 'reject' | 'view') => {
        setActionState((state) => ({ ...state, [id]: action }))
    }

    const clearAction = (id: string) => {
        setActionState((state) => {
            const next = { ...state }
            delete next[id]
            return next
        })
    }

    const openResolveDialog = (approval: HumanInputRequest, action: 'approve' | 'reject' | 'view') => {
        setSelectedApproval(approval)
        setResolveAction(action)
        setResponseNote('')
        setFormValues({})
        setSelectedOptions([])
        setResolveDialogOpen(true)
    }

    const handleResolve = async () => {
        if (!selectedApproval) return

        markAction(selectedApproval.id, resolveAction)
        setResolveDialogOpen(false)

        try {
            const data: any = {
                status: resolveAction === 'approve' ? 'approved' : 'rejected',
                comment: responseNote || undefined
            }

            if (selectedApproval.inputType === 'selection') {
                data.selection = parsedInputSchema?.multiple ? selectedOptions : selectedOptions[0]
                data.approved = resolveAction === 'approve'
            } else if (selectedApproval.inputType === 'form') {
                Object.assign(data, formValues)
                data.approved = resolveAction === 'approve'
            }

            await api.humanInputs.resolve(selectedApproval.id, {
                status: 'resolved',
                responseData: data,
                comment: responseNote || undefined
            })

            toast({
                title: resolveAction === 'approve' ? 'Approved' : 'Rejected',
                description: `"${selectedApproval.title}" has been ${resolveAction}d.`,
            })

            // Refresh the list
            await fetchApprovals()
        } catch (err) {
            toast({
                title: 'Action failed',
                description: err instanceof Error ? err.message : 'Try again in a moment.',
                variant: 'destructive',
            })
        } finally {
            clearAction(selectedApproval.id)
            setSelectedApproval(null)
        }
    }

    const handleRefresh = async () => {
        await fetchApprovals()
        toast({
            title: 'Requests refreshed',
            description: 'Latest status have been loaded.',
        })
    }

    const isActionBusy = (id: string) => Boolean(actionState[id])

    const renderStatusBadge = (approval: HumanInputRequest) => {
        let status = approval.status as string
        if (status === 'resolved' && approval.responseData?.status) {
            status = approval.responseData.status as string
        }

        const variant = STATUS_VARIANTS[status] || 'outline'
        const label = status.charAt(0).toUpperCase() + status.slice(1)
        const Icon = STATUS_ICONS[status] || Clock
        return (
            <Badge variant={variant} className="gap-1">
                <Icon className="h-3 w-3" />
                {label}
            </Badge>
        )
    }

    const hasData = filteredApprovals.length > 0

    return (
        <TooltipProvider>
            <div className="flex-1 bg-background">
                <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
                    {/* Header */}
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10">
                                <Zap className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold">Action Center</h1>
                                <p className="text-sm text-muted-foreground">
                                    Review and respond to workflow requests
                                </p>
                            </div>
                        </div>
                        {pendingCount > 0 && (
                            <Badge variant="default" className="text-base px-3 py-1">
                                {pendingCount} pending
                            </Badge>
                        )}
                    </div>

                    {/* Filters */}
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <div className="flex-1 space-y-2">
                            <label className="text-xs uppercase text-muted-foreground flex items-center gap-2">
                                <Search className="h-3.5 w-3.5" />
                                Search requests
                            </label>
                            <Input
                                placeholder="Filter by title, node, or run ID"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                variant="outline"
                                className="gap-2"
                                onClick={handleRefresh}
                                disabled={isLoading}
                            >
                                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                                <span className="hidden sm:inline">Refresh</span>
                            </Button>
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between">
                            <span>{error}</span>
                            <Button variant="outline" size="sm" onClick={handleRefresh}>
                                Try again
                            </Button>
                        </div>
                    )}

                    {/* Table */}
                    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="min-w-[200px]">Title</TableHead>
                                        <TableHead className="min-w-[120px] hidden md:table-cell">Node</TableHead>
                                        <TableHead className="min-w-[150px] hidden lg:table-cell">Run ID</TableHead>
                                        <TableHead className="min-w-[130px] hidden sm:table-cell">Created</TableHead>
                                        <TableHead className="min-w-[100px] hidden lg:table-cell">Timeout</TableHead>
                                        <TableHead className="min-w-[100px]">Status</TableHead>
                                        <TableHead className="text-right min-w-[180px]">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading && !hasData
                                        ? Array.from({ length: 4 }).map((_, index) => (
                                            <TableRow key={`skeleton-${index}`}>
                                                {Array.from({ length: 7 }).map((_, cell) => (
                                                    <TableCell key={`cell-${cell}`}>
                                                        <Skeleton className="h-5 w-full" />
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))
                                        : null}
                                    {!isLoading && hasData
                                        ? filteredApprovals.map((approval) => {
                                            const isPending = approval.status === 'pending'

                                            return (
                                                <TableRow key={approval.id}>
                                                    <TableCell className="font-medium">
                                                        <div className="flex flex-col">
                                                            <span className="truncate max-w-[200px]">{approval.title}</span>
                                                            {approval.description && (
                                                                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                                    {approval.description}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="hidden md:table-cell">
                                                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                                            {approval.nodeRef}
                                                        </code>
                                                    </TableCell>
                                                    <TableCell className="hidden lg:table-cell">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <a
                                                                    href={`/workflows/${approval.workflowId}/runs/${approval.runId}`}
                                                                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                                                                >
                                                                    {approval.runId.substring(0, 12)}...
                                                                    <ExternalLink className="h-3 w-3" />
                                                                </a>
                                                            </TooltipTrigger>
                                                            <TooltipContent>View run details</TooltipContent>
                                                        </Tooltip>
                                                    </TableCell>
                                                    <TableCell className="text-sm hidden sm:table-cell">
                                                        {formatDateTime(approval.createdAt)}
                                                    </TableCell>
                                                    <TableCell className="text-sm hidden lg:table-cell">
                                                        {approval.timeoutAt ? (
                                                            <span className={approval.status === 'pending' ? 'text-warning' : ''}>
                                                                {formatRelativeTime(approval.timeoutAt)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted-foreground">No timeout</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>{renderStatusBadge(approval)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            {isPending ? (
                                                                <>
                                                                    <Button
                                                                        variant="default"
                                                                        size="sm"
                                                                        className="gap-1 h-8"
                                                                        onClick={() => openResolveDialog(approval, 'approve')}
                                                                        disabled={isActionBusy(approval.id)}
                                                                    >
                                                                        <CheckCircle className="h-4 w-4" />
                                                                        Approve
                                                                    </Button>
                                                                    <Button
                                                                        variant="destructive"
                                                                        size="sm"
                                                                        className="gap-1 h-8"
                                                                        onClick={() => openResolveDialog(approval, 'reject')}
                                                                        disabled={isActionBusy(approval.id)}
                                                                    >
                                                                        <XCircle className="h-4 w-4" />
                                                                        Reject
                                                                    </Button>
                                                                </>
                                                            ) : (
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="gap-1 h-8"
                                                                    onClick={() => openResolveDialog(approval, 'view')}
                                                                >
                                                                    <ExternalLink className="h-4 w-4" />
                                                                    View Details
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })
                                        : null}
                                    {!isLoading && !hasData && (
                                        <TableRow>
                                            <TableCell colSpan={7}>
                                                <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                                                    <Zap className="h-12 w-12 text-muted-foreground/30" />
                                                    <p className="font-medium">No pending actions</p>
                                                    <p className="text-sm text-muted-foreground max-w-lg">
                                                        {statusFilter === 'pending'
                                                            ? 'All requests have been handled. Check back later or view all statuses.'
                                                            : 'No requests match your filters. Try adjusting the search or status filter.'}
                                                    </p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Resolve Dialog */}
            <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {resolveAction === 'approve' ? 'Approve Request' :
                                resolveAction === 'reject' ? 'Reject Request' : 'Request Details'}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedApproval?.title}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
                        {selectedApproval?.description && (
                            <div className="space-y-2">
                                <Label className="text-muted-foreground text-xs uppercase letter-spacing-wide">Description</Label>
                                <div className="border rounded-md p-4 bg-muted/30">
                                    <MarkdownView content={selectedApproval.description} className="prose prose-sm dark:prose-invert max-w-none" />
                                </div>
                            </div>
                        )}

                        {/* Input UI for Pending Tasks */}
                        {selectedApproval?.status === 'pending' && (
                            <div className="space-y-6 pt-2 border-t mt-4">
                                {selectedApproval.inputType === 'selection' && (
                                    <div className="space-y-3">
                                        <Label className="text-sm font-semibold">Please select an option</Label>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {(parsedInputSchema?.options || []).map((option: any) => {
                                                const value = typeof option === 'string' ? option : option.value
                                                const label = typeof option === 'string' ? option : option.label
                                                const isSelected = selectedOptions.includes(value)

                                                return (
                                                    <Button
                                                        key={value}
                                                        variant={isSelected ? 'default' : 'outline'}
                                                        className={cn(
                                                            "justify-start h-auto py-3 px-4 text-left transition-all",
                                                            isSelected && "ring-2 ring-primary ring-offset-2"
                                                        )}
                                                        onClick={() => {
                                                            if (parsedInputSchema?.multiple) {
                                                                setSelectedOptions(prev =>
                                                                    prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
                                                                )
                                                            } else {
                                                                setSelectedOptions([value])
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={cn(
                                                                "w-4 h-4 rounded-full border flex items-center justify-center",
                                                                isSelected ? "bg-primary-foreground border-primary-foreground" : "border-muted-foreground"
                                                            )}>
                                                                {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                                                            </div>
                                                            <span className="font-medium">{label}</span>
                                                        </div>
                                                    </Button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}

                                {selectedApproval.inputType === 'form' && parsedInputSchema?.properties && (
                                    <div className="space-y-4">
                                        <Label className="text-sm font-semibold">Complete the form</Label>
                                        <div className="grid grid-cols-1 gap-4 bg-muted/20 p-4 rounded-lg border">
                                            {Object.entries(parsedInputSchema.properties).map(([key, prop]: [string, any]) => (
                                                <div key={key} className="space-y-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <Label htmlFor={`form-${key}`} className="text-sm font-medium">
                                                            {prop.title || key}
                                                            {parsedInputSchema.required?.includes(key) && (
                                                                <span className="text-destructive ml-1">*</span>
                                                            )}
                                                        </Label>
                                                    </div>
                                                    {prop.type === 'string' && prop.enum ? (
                                                        <Select
                                                            value={formValues[key] || ''}
                                                            onValueChange={(v) => setFormValues(prev => ({ ...prev, [key]: v }))}
                                                        >
                                                            <SelectTrigger id={`form-${key}`}>
                                                                <SelectValue placeholder={`Select ${key}...`} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {prop.enum.map((v: string) => (
                                                                    <SelectItem key={v} value={v}>{v}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    ) : prop.type === 'string' ? (
                                                        <Input
                                                            id={`form-${key}`}
                                                            value={formValues[key] || ''}
                                                            onChange={(e) => setFormValues(prev => ({ ...prev, [key]: e.target.value }))}
                                                            placeholder={prop.description || ""}
                                                        />
                                                    ) : prop.type === 'number' ? (
                                                        <Input
                                                            id={`form-${key}`}
                                                            type="number"
                                                            value={formValues[key] || ''}
                                                            onChange={(e) => setFormValues(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                                                        />
                                                    ) : prop.type === 'boolean' ? (
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <input
                                                                type="checkbox"
                                                                id={`form-${key}`}
                                                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                                checked={formValues[key] || false}
                                                                onChange={(e) => setFormValues(prev => ({ ...prev, [key]: e.target.checked }))}
                                                            />
                                                            <Label htmlFor={`form-${key}`} className="text-sm">{prop.description || key}</Label>
                                                        </div>
                                                    ) : (
                                                        <Textarea
                                                            id={`form-${key}`}
                                                            value={formValues[key] || ''}
                                                            onChange={(e) => setFormValues(prev => ({ ...prev, [key]: e.target.value }))}
                                                            placeholder="JSON or text block"
                                                        />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Results showing old resolutions */}
                        {selectedApproval?.status === 'resolved' && (
                            <Card className="border-primary/20 bg-primary/5 shadow-sm">
                                <CardHeader className="py-3 px-4 border-b border-primary/10">
                                    <div className="flex items-center justify-between">
                                        <CardDescription className="text-primary font-bold flex items-center gap-2">
                                            <CheckCircle className="h-4 w-4" />
                                            Resolution Details
                                        </CardDescription>
                                        <Badge variant="outline" className="bg-background text-[10px] font-normal">
                                            Resolved {selectedApproval.respondedAt && formatDateTime(selectedApproval.respondedAt)}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="py-4 px-4 space-y-4">
                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] uppercase text-muted-foreground tracking-widest font-bold">Outcome</Label>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                {renderStatusBadge(selectedApproval)}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] uppercase text-muted-foreground tracking-widest font-bold">Actor</Label>
                                            <div className="text-sm font-medium mt-0.5">{selectedApproval.respondedBy || 'System Agent'}</div>
                                        </div>
                                    </div>

                                    {selectedApproval.responseData && Object.keys(selectedApproval.responseData).length > 0 && (
                                        <div className="space-y-2">
                                            <Label className="text-[10px] uppercase text-muted-foreground tracking-widest font-bold">Captured Data</Label>
                                            <div className="bg-background/80 rounded border border-primary/10 overflow-hidden">
                                                <div className="max-h-60 overflow-y-auto scrollbar-thin">
                                                    <pre className="text-xs p-3 leading-relaxed">
                                                        {JSON.stringify(selectedApproval.responseData, null, 2)}
                                                    </pre>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        <div className="space-y-4 border-t pt-4 mt-2">
                            {selectedApproval?.context && Object.keys(selectedApproval.context).length > 0 && (
                                <div className="space-y-2">
                                    <Label className="text-muted-foreground text-xs uppercase letter-spacing-wide">Activity Context</Label>
                                    <div className="bg-muted/50 rounded-md border text-[11px] p-2 leading-tight">
                                        <pre className="overflow-auto max-h-32 scrollbar-none">
                                            {JSON.stringify(selectedApproval.context, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            )}

                            {selectedApproval?.status === 'pending' && (
                                <div className="space-y-2">
                                    <Label htmlFor="response-note" className="text-sm font-medium">Resolution Note (optional)</Label>
                                    <Textarea
                                        id="response-note"
                                        placeholder="Add context for this decision..."
                                        className="resize-none min-h-[80px]"
                                        value={responseNote}
                                        onChange={(e) => setResponseNote(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                    <DialogFooter className="bg-muted/10 -mx-6 -mb-6 px-6 py-4 border-t">
                        <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>
                            {selectedApproval?.status === 'pending' ? 'Discard' : 'Close Details'}
                        </Button>
                        {selectedApproval?.status === 'pending' && (
                            <Button
                                variant={resolveAction === 'approve' ? 'default' : 'destructive'}
                                className="min-w-[120px]"
                                onClick={handleResolve}
                                disabled={
                                    (() => {
                                        if (selectedApproval.inputType === 'selection') return selectedOptions.length === 0;
                                        if (selectedApproval.inputType === 'form') return parsedInputSchema?.required?.some((k: string) => !formValues[k]);
                                        return false;
                                    })()
                                }
                            >
                                {resolveAction === 'approve' ? (
                                    <>
                                        <CheckCircle className="h-4 w-4 mr-2" />
                                        Submit Approval
                                    </>
                                ) : (
                                    <>
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Submit Rejection
                                    </>
                                )}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog >
        </TooltipProvider >
    )
}
