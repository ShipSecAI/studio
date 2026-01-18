import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2, Plus, X, Copy, Check, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/services/api'
import type { WebhookConfiguration } from '@shipsec/shared'
import { env } from '@/config/env'
import { WebhookDetails } from './WebhookDetails'
import { useApiKeyStore } from '@/store/apiKeyStore'
import type { Node as ReactFlowNode } from 'reactflow'
import type { FrontendNodeData } from '@/schemas/node'

const WEBHOOK_BASE_URL = env.VITE_API_URL || 'https://api.shipsec.ai'

// State passed when navigating to webhook editor from workflow
export interface WebhookNavigationState {
    returnTo?: {
        path: string
        openWebhooksSidebar?: boolean
    }
}

export interface WorkflowWebhooksSidebarProps {
    workflowId: string
    nodes: ReactFlowNode<FrontendNodeData>[]
    defaultWebhookUrl: string
    onClose: () => void
}

export function WorkflowWebhooksSidebar({
    workflowId,
    nodes,
    defaultWebhookUrl,
    onClose,
}: WorkflowWebhooksSidebarProps) {
    const navigate = useNavigate()
    const location = useLocation()
    const { lastCreatedKey } = useApiKeyStore()
    const [webhooks, setWebhooks] = useState<WebhookConfiguration[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [copiedId, setCopiedId] = useState<string | null>(null)

    useEffect(() => {
        const fetchWebhooks = async () => {
            setIsLoading(true)
            setError(null)
            try {
                const allWebhooks = await api.webhooks.list()
                // Filter webhooks for this workflow
                const filtered = allWebhooks.filter((w: WebhookConfiguration) => w.workflowId === workflowId)
                setWebhooks(filtered)
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load webhooks')
            } finally {
                setIsLoading(false)
            }
        }
        fetchWebhooks()
    }, [workflowId])

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedId(id)
            setTimeout(() => setCopiedId(null), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    // Calculate default entrypoint payload from nodes
    const entryPointPayload = useMemo(() => {
        const entryNode = nodes.find(n => n.data.componentId === 'core.workflow.entrypoint' || n.data.componentSlug === 'entry-point')
        const params = entryNode?.data.config?.params || {}
        if (!entryNode || !params.runtimeInputs) return {}
        try {
            const inputs = typeof params.runtimeInputs === 'string'
                ? JSON.parse(params.runtimeInputs)
                : params.runtimeInputs

            if (!Array.isArray(inputs)) return {}

            return inputs.reduce((acc: any, input: any) => {
                acc[input.id] = input.type === 'number' ? 0 : input.type === 'boolean' ? false : 'value'
                return acc
            }, {})
        } catch {
            return {}
        }
    }, [nodes])

    // Build navigation state that tells webhook editor to return here with sidebar open
    const buildNavigationState = (): WebhookNavigationState => ({
        returnTo: {
            path: location.pathname,
            openWebhooksSidebar: true,
        }
    })

    const handleCreateWebhook = () => {
        navigate(`/webhooks/new?workflowId=${workflowId}`, { state: buildNavigationState() })
    }

    const handleViewWebhook = (webhookId: string) => {
        navigate(`/webhooks/${webhookId}`, { state: buildNavigationState() })
    }

    const handleViewAllWebhooks = () => {
        navigate(`/webhooks?workflowId=${workflowId}`)
    }

    return (
        <div className="flex h-full flex-col border-l bg-background">
            <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm">Webhooks</h3>
                    <Badge variant="outline" className="text-[11px] font-medium">
                        {webhooks.length + 1}
                    </Badge>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <div className="px-4 py-3 border-b bg-muted/20">
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={handleCreateWebhook}>
                        <Plus className="mr-1 h-4 w-4" />
                        New Custom Webhook
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleViewAllWebhooks}>
                        View All
                    </Button>
                </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {/* Default Webhook - Always shown */}
                <div className="space-y-2 rounded-lg border bg-gradient-to-r from-primary/5 to-transparent px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <Globe className="h-4 w-4 text-primary shrink-0" />
                                <span className="text-sm font-semibold">Default Webhook</span>
                                <Badge variant="secondary" className="text-[10px]">Built-in</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Accepts raw JSON payloads directly as workflow inputs
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded truncate font-mono">
                            {defaultWebhookUrl}
                        </code>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            onClick={() => handleCopy(defaultWebhookUrl, 'default')}
                            title="Copy URL"
                        >
                            {copiedId === 'default' ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </Button>
                        <WebhookDetails
                            url={defaultWebhookUrl}
                            payload={entryPointPayload}
                            apiKey={lastCreatedKey}
                            triggerLabel=""
                            className="h-7 w-7 p-0 shrink-0"
                        />
                    </div>
                </div>

                {/* Divider */}
                {webhooks.length > 0 && (
                    <div className="flex items-center gap-2 py-1">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Custom Webhooks</span>
                        <div className="flex-1 h-px bg-border" />
                    </div>
                )}

                {/* Loading State */}
                {isLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading webhooks…
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <p className="text-sm text-destructive py-2">{error}</p>
                )}

                {/* Empty State */}
                {!isLoading && !error && webhooks.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">
                        No custom webhooks yet. Create one to transform incoming payloads.
                    </div>
                )}

                {/* Custom Webhooks List */}
                {!isLoading && !error && webhooks.map((webhook) => {
                    const webhookUrl = `${WEBHOOK_BASE_URL}/webhooks/inbound/${webhook.webhookPath}`

                    // Generate a sample payload that combines expectedInputs with generic fields
                    // to show it can accept "whatever payload"
                    const samplePayload: any = {
                        event_type: 'webhook_event',
                        timestamp: new Date().toISOString(),
                    }

                    if (Array.isArray(webhook.expectedInputs)) {
                        webhook.expectedInputs.forEach((input: any) => {
                            samplePayload[input.id] = input.type === 'number' ? 0 : input.type === 'boolean' ? false : 'value'
                        })
                    }

                    return (
                        <div
                            key={webhook.id}
                            className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => handleViewWebhook(webhook.id)}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1 flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold truncate">{webhook.name}</span>
                                        <Badge
                                            variant={webhook.status === 'active' ? 'default' : 'secondary'}
                                            className="text-[10px] capitalize shrink-0"
                                        >
                                            {webhook.status}
                                        </Badge>
                                    </div>
                                    {webhook.description && (
                                        <p className="text-xs text-muted-foreground truncate">
                                            {webhook.description}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 shrink-0"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleCopy(webhookUrl, webhook.id)
                                        }}
                                        title="Copy URL"
                                    >
                                        {copiedId === webhook.id ? (
                                            <Check className="h-3.5 w-3.5 text-green-500" />
                                        ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                        )}
                                    </Button>
                                    <div onClick={(e) => e.stopPropagation()}>
                                        <WebhookDetails
                                            url={webhookUrl}
                                            payload={samplePayload}
                                            apiKey={null}
                                            triggerLabel=""
                                            className="h-7 w-7 p-0 shrink-0"
                                            hideAuth={true}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 text-[10px] bg-muted px-2 py-1 rounded truncate font-mono text-muted-foreground">
                                    /{webhook.webhookPath}
                                </code>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
