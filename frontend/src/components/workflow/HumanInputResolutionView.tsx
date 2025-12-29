import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { MarkdownView } from '@/components/ui/markdown'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { useToast } from '@/components/ui/use-toast'

export interface HumanInputRequest {
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

interface HumanInputResolutionViewProps {
    request: HumanInputRequest
    onResolved?: (request: HumanInputRequest) => void
    onCancel?: () => void
    initialAction?: 'approve' | 'reject' | 'view'
}

const STATUS_ICONS: Record<string, any> = {
    pending: Clock,
    approved: CheckCircle,
    rejected: XCircle,
    expired: Clock,
    cancelled: XCircle,
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    pending: 'default',
    approved: 'secondary',
    rejected: 'destructive',
    expired: 'outline',
    cancelled: 'outline',
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

export function HumanInputResolutionView({
    request,
    onResolved,
    onCancel,
    initialAction = 'approve'
}: HumanInputResolutionViewProps) {
    const { toast } = useToast()
    const [submitting, setSubmitting] = useState(false)
    const [resolveAction, setResolveAction] = useState<'approve' | 'reject' | 'view'>(
        request.status === 'pending' ? initialAction : 'view'
    )
    const [responseNote, setResponseNote] = useState('')
    const [formValues, setFormValues] = useState<Record<string, any>>({})
    const [selectedOptions, setSelectedOptions] = useState<string[]>([])

    const parsedInputSchema = useMemo(() => {
        if (!request.inputSchema) return null
        if (typeof request.inputSchema === 'object') return request.inputSchema
        try {
            return JSON.parse(request.inputSchema)
        } catch (e) {
            console.error('Failed to parse inputSchema:', e)
            return null
        }
    }, [request.inputSchema])

    const handleResolve = async () => {
        if (request.status !== 'pending') return

        setSubmitting(true)

        try {
            const isApprovalType = request.inputType === 'approval' || request.inputType === 'review'
            const data: any = {
                comment: responseNote || undefined,
                approved: resolveAction === 'approve'
            }

            if (isApprovalType) {
                data.status = resolveAction === 'approve' ? 'approved' : 'rejected'
            }

            if (request.inputType === 'selection') {
                data.selection = parsedInputSchema?.multiple ? selectedOptions : selectedOptions[0]
            } else if (request.inputType === 'form') {
                Object.assign(data, formValues)
            }

            const updatedRequest = await api.humanInputs.resolve(request.id, {
                status: 'resolved',
                responseData: data,
                comment: responseNote || undefined
            })

            const actionText = request.inputType === 'acknowledge' ? 'Acknowledged' : (resolveAction === 'approve' ? 'Approved' : 'Rejected')
            toast({
                title: actionText,
                description: `"${request.title}" has been ${actionText.toLowerCase()}.`,
            })

            onResolved?.(updatedRequest as unknown as HumanInputRequest)
        } catch (err) {
            toast({
                title: 'Action failed',
                description: err instanceof Error ? err.message : 'Try again in a moment.',
                variant: 'destructive',
            })
        } finally {
            setSubmitting(false)
        }
    }

    const renderStatusBadge = (status: string) => {
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

    const isPending = request.status === 'pending'

    return (
        <div className="space-y-4 py-4 pr-2">
            <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">
                    {request.inputType.toUpperCase()}
                </Badge>
                <div className="text-[10px] text-muted-foreground">
                    ID: {request.id.substring(0, 8)}
                </div>
            </div>

            <div className="space-y-1">
                <h3 className="text-lg font-bold leading-tight">{request.title}</h3>
                <div className="text-xs text-muted-foreground">
                    Created {formatDateTime(request.createdAt)}
                </div>
            </div>

            {request.description && (
                <div className="space-y-2">
                    <Label className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold">Description</Label>
                    <div className="border rounded-md p-3 bg-muted/30">
                        <MarkdownView content={request.description} className="prose prose-sm dark:prose-invert max-w-none" />
                    </div>
                </div>
            )}

            {/* Input UI for Pending Tasks */}
            {isPending && resolveAction !== 'view' && (
                <div className="space-y-6 pt-4 border-t">
                    {request.inputType === 'approval' && (
                        <div className="space-y-3">
                            <Label className="text-sm font-semibold">Your Decision</Label>
                            <div className="grid grid-cols-2 gap-3">
                                <Button
                                    variant={resolveAction === 'approve' ? 'default' : 'outline'}
                                    className={cn(
                                        "h-20 flex-col gap-1 transition-all border-2",
                                        resolveAction === 'approve' ? "border-primary/50 bg-primary/5 text-primary hover:bg-primary/10" : "border-muted"
                                    )}
                                    onClick={() => setResolveAction('approve')}
                                >
                                    <CheckCircle className="h-5 w-5" />
                                    <span className="font-bold">Approve</span>
                                </Button>
                                <Button
                                    variant={resolveAction === 'reject' ? 'default' : 'outline'}
                                    className={cn(
                                        "h-20 flex-col gap-1 transition-all border-2",
                                        resolveAction === 'reject' ? "border-destructive/50 bg-destructive/5 text-destructive hover:bg-destructive/10" : "border-muted"
                                    )}
                                    onClick={() => setResolveAction('reject')}
                                >
                                    <XCircle className="h-5 w-5" />
                                    <span className="font-bold">Reject</span>
                                </Button>
                            </div>
                        </div>
                    )}

                    {request.inputType === 'review' && (
                        <div className="flex justify-center mb-2">
                            <div className="flex p-1 bg-muted rounded-lg w-full max-w-[300px]">
                                <Button
                                    variant={resolveAction === 'approve' ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="flex-1 h-8 px-4"
                                    onClick={() => setResolveAction('approve')}
                                >
                                    Approve
                                </Button>
                                <Button
                                    variant={resolveAction === 'reject' ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="flex-1 h-8 px-4"
                                    onClick={() => setResolveAction('reject')}
                                >
                                    Reject
                                </Button>
                            </div>
                        </div>
                    )}

                    {request.inputType === 'acknowledge' && (
                        <div className="flex flex-col items-center justify-center py-6 space-y-4">
                            <div className="p-4 rounded-full bg-primary/10 text-primary">
                                <Clock className="h-10 w-10" />
                            </div>
                            <p className="text-sm text-center text-muted-foreground">
                                Please acknowledge that you have reviewed the details above.
                            </p>
                        </div>
                    )}

                    {request.inputType === 'selection' && (
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

                    {request.inputType === 'form' && parsedInputSchema?.properties && (
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
                                        ) : (prop.type === 'number' || prop.type === 'integer') ? (
                                            <Input
                                                id={`form-${key}`}
                                                type="number"
                                                value={formValues[key] || ''}
                                                onChange={(e) => setFormValues(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                                            />
                                        ) : prop.type === 'boolean' ? (
                                            <div className="flex items-center gap-2 mt-2">
                                                <Input
                                                    type="checkbox"
                                                    id={`form-${key}`}
                                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                    checked={formValues[key] || false}
                                                    onChange={(e: any) => setFormValues(prev => ({ ...prev, [key]: e.target.checked }))}
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
                </div>
            )}

            {/* Results showing old resolutions */}
            {request.status === 'resolved' && (
                <Card className="border-primary/20 bg-primary/5 shadow-sm">
                    <CardHeader className="py-3 px-4 border-b border-primary/10">
                        <div className="flex items-center justify-between">
                            <CardDescription className="text-primary font-bold flex items-center gap-2">
                                <CheckCircle className="h-4 w-4" />
                                Resolution Details
                            </CardDescription>
                            <Badge variant="outline" className="bg-background text-[10px] font-normal">
                                Resolved {request.respondedAt && formatDateTime(request.respondedAt)}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="py-4 px-4 space-y-4">
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-1">
                                <Label className="text-[10px] uppercase text-muted-foreground tracking-widest font-bold">Outcome</Label>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    {renderStatusBadge(request.responseData?.status as string || 'resolved')}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[10px] uppercase text-muted-foreground tracking-widest font-bold">Actor</Label>
                                <div className="text-sm font-medium mt-0.5">{request.respondedBy || 'System Agent'}</div>
                            </div>
                        </div>

                        {request.responseData && Object.keys(request.responseData).length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-[10px] uppercase text-muted-foreground tracking-widest font-bold">Captured Data</Label>
                                <div className="bg-background/80 rounded border border-primary/10 overflow-hidden">
                                    <div className="max-h-60 overflow-y-auto scrollbar-thin">
                                        <pre className="text-xs p-3 leading-relaxed">
                                            {JSON.stringify(request.responseData, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <div className="pt-4 border-t flex flex-col sm:flex-row justify-end gap-2 bg-background sticky bottom-0 -mb-4 pb-4">
                <Button variant="outline" onClick={onCancel} disabled={submitting}>
                    {isPending ? 'Discard' : 'Close Details'}
                </Button>
                {isPending && (
                    <Button
                        variant={resolveAction === 'approve' ? 'default' : 'destructive'}
                        className="min-w-[120px]"
                        onClick={handleResolve}
                        disabled={
                            submitting ||
                            (() => {
                                if (request.inputType === 'selection') return selectedOptions.length === 0;
                                if (request.inputType === 'form') return parsedInputSchema?.required?.some((k: string) => {
                                    const val = formValues[k];
                                    return val === undefined || val === null || val === '';
                                });
                                return false;
                            })()
                        }
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : request.inputType === 'acknowledge' ? (
                            <CheckCircle className="h-4 w-4 mr-2" />
                        ) : (request.inputType === 'approval' || request.inputType === 'review') ? (
                            resolveAction === 'approve' ? (
                                <CheckCircle className="h-4 w-4 mr-2" />
                            ) : (
                                <XCircle className="h-4 w-4 mr-2" />
                            )
                        ) : (
                            <CheckCircle className="h-4 w-4 mr-2" />
                        )}
                        {request.inputType === 'acknowledge' ? 'Acknowledge' :
                            (request.inputType === 'approval' || request.inputType === 'review') ?
                                (resolveAction === 'approve' ? 'Submit Approval' : 'Submit Rejection') :
                                'Submit Response'}
                    </Button>
                )}
            </div>
        </div>
    )
}
