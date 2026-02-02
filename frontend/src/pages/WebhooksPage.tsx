import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
// Textarea and Label removed
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Plus, Trash2, ExternalLink, Link2, Copy, RotateCw } from 'lucide-react';
import { useWebhookStore } from '@/store/webhookStore';
import { api } from '@/services/api';
import { env } from '@/config/env';
import type { WebhookConfiguration } from '@shipsec/shared';

interface WorkflowOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  inactive: 'secondary',
  error: 'destructive',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
  }).format(date);
};

const getWorkflowName = (workflowId: string, workflows: WorkflowOption[]): string => {
  const match = workflows.find((workflow) => workflow.id === workflowId);
  return match?.name ?? 'Unknown workflow';
};

const WEBHOOK_BASE_URL = env.VITE_API_URL || 'https://api.shipsec.ai';

export function WebhooksPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [actionState, setActionState] = useState<Record<string, 'delete' | 'regenerate' | 'test'>>(
    {},
  );

  const webhooks = useWebhookStore((state) => state.webhooks);
  const isLoading = useWebhookStore((state) => state.isLoading);
  const error = useWebhookStore((state) => state.error);
  const filters = useWebhookStore((state) => state.filters);
  const fetchWebhooks = useWebhookStore((state) => state.fetchWebhooks);
  const refreshWebhooks = useWebhookStore((state) => state.refreshWebhooks);
  const setFilters = useWebhookStore((state) => state.setFilters);
  const deleteWebhook = useWebhookStore((state) => state.deleteWebhook);
  const regeneratePath = useWebhookStore((state) => state.regeneratePath);

  useEffect(() => {
    const initialWorkflowId = searchParams.get('workflowId');
    if (initialWorkflowId) {
      setFilters({ workflowId: initialWorkflowId });
    }
  }, []);

  useEffect(() => {
    fetchWebhooks({ force: true }).catch(() => {});
  }, [fetchWebhooks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const workflowList = await api.workflows.list();
        if (cancelled) return;
        const normalized = workflowList.map((workflow) => ({
          id: workflow.id,
          name: workflow.name ?? 'Untitled workflow',
        }));
        setWorkflowOptions(normalized);
      } catch (_err) {
        console.error('Failed to load workflows', _err);
        toast({
          title: 'Unable to load workflows',
          description: _err instanceof Error ? _err.message : 'Please try refreshing the page.',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) {
          setWorkflowsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const filteredWebhooks = useMemo(() => {
    const query = filters.search.trim().toLowerCase();

    return webhooks.filter((webhook) => {
      const workflowName = getWorkflowName(webhook.workflowId, workflowOptions);
      const matchesSearch =
        query.length === 0 ||
        webhook.name.toLowerCase().includes(query) ||
        workflowName.toLowerCase().includes(query) ||
        webhook.webhookPath.toLowerCase().includes(query);

      const matchesStatus = filters.status === 'all' || webhook.status === filters.status;

      return matchesSearch && matchesStatus;
    });
  }, [filters.search, filters.status, webhooks, workflowOptions]);

  const handleWorkflowFilterChange = (value: string) => {
    const workflowId = value === 'all' ? null : value;
    setFilters({ workflowId });
    const nextParams = new URLSearchParams(searchParams);
    if (workflowId) {
      nextParams.set('workflowId', workflowId);
    } else {
      nextParams.delete('workflowId');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleStatusFilterChange = (value: string) => {
    setFilters({ status: value as typeof filters.status });
  };

  const handleCopyUrl = async (webhook: WebhookConfiguration) => {
    const url = `${WEBHOOK_BASE_URL}/webhooks/inbound/${webhook.webhookPath}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Webhook URL copied',
        description: 'The webhook URL has been copied to your clipboard.',
      });
    } catch (_err) {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy the webhook URL to clipboard.',
        variant: 'destructive',
      });
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshWebhooks();
      toast({
        title: 'Webhooks refreshed',
        description: 'Latest webhook configurations have been loaded.',
      });
    } catch (_err) {
      toast({
        title: 'Refresh failed',
        description: _err instanceof Error ? _err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    }
  };

  const renderStatusBadge = (status: string) => {
    const variant = STATUS_VARIANTS[status] || 'outline';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return <Badge variant={variant}>{label}</Badge>;
  };

  const isActionBusy = (id: string) => Boolean(actionState[id]);

  const handleDelete = async (webhook: WebhookConfiguration) => {
    if (!confirm(`Are you sure you want to delete the webhook "${webhook.name}"?`)) {
      return;
    }

    setActionState((prev) => ({ ...prev, [webhook.id]: 'delete' }));
    try {
      await deleteWebhook(webhook.id);
      toast({
        title: 'Webhook deleted',
        description: `Successfully deleted webhook ${webhook.name}`,
      });
    } catch (_err) {
      toast({
        title: 'Failed to delete webhook',
        description: _err instanceof Error ? _err.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setActionState((prev) => {
        const { [webhook.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleRegeneratePath = async (webhook: WebhookConfiguration) => {
    if (
      !confirm(
        `Are you sure you want to regenerate the URL for "${webhook.name}"? The old URL will stop working.`,
      )
    ) {
      return;
    }

    setActionState((prev) => ({ ...prev, [webhook.id]: 'regenerate' }));
    try {
      await regeneratePath(webhook.id);
      toast({
        title: 'URL regenerated',
        description: 'New webhook URL has been generated',
      });
    } catch (_err) {
      toast({
        title: 'Failed to regenerate URL',
        description: _err instanceof Error ? _err.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setActionState((prev) => {
        const { [webhook.id]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const hasData = filteredWebhooks.length > 0;

  return (
    <TooltipProvider>
      <div className="flex-1 bg-background">
        <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
          {/* Filters Row */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="flex-1 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <label className="text-xs uppercase text-muted-foreground">Search</label>
                <Input
                  placeholder="Filter by name, workflow, or URL"
                  value={filters.search}
                  onChange={(e) => setFilters({ search: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase text-muted-foreground">Status</label>
                <Select value={filters.status} onValueChange={handleStatusFilterChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase text-muted-foreground">Workflow</label>
                <Select
                  value={filters.workflowId ?? 'all'}
                  onValueChange={handleWorkflowFilterChange}
                  disabled={workflowsLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All workflows" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All workflows</SelectItem>
                    {workflowOptions.map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col shrink-0">
              <label className="text-xs uppercase text-muted-foreground invisible hidden lg:block">
                &nbsp;
              </label>
              <div className="flex gap-2 mt-2 lg:mt-0">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleRefresh}
                  disabled={isLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <Button
                  variant="default"
                  className="gap-2"
                  onClick={() => navigate('/webhooks/new')}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">New webhook</span>
                </Button>
              </div>
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

          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Name</TableHead>
                    <TableHead className="min-w-[120px] hidden md:table-cell">Workflow</TableHead>
                    <TableHead className="min-w-[200px]">Webhook URL</TableHead>
                    <TableHead className="min-w-[100px] hidden lg:table-cell">Created</TableHead>
                    <TableHead className="min-w-[80px]">Status</TableHead>
                    <TableHead className="text-right min-w-[200px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && !hasData
                    ? Array.from({ length: 4 }).map((_, index) => (
                        <TableRow key={`skeleton-${index}`}>
                          {Array.from({ length: 6 }).map((_, cell) => (
                            <TableCell key={`cell-${cell}`}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : null}
                  {!isLoading && hasData
                    ? filteredWebhooks.map((webhook) => {
                        const workflowName = getWorkflowName(webhook.workflowId, workflowOptions);

                        return (
                          <TableRow
                            key={webhook.id}
                            className="cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => navigate(`/webhooks/${webhook.id}`)}
                          >
                            <TableCell className="font-medium">
                              <div className="flex flex-col">
                                <span className="truncate max-w-[140px]">{webhook.name}</span>
                                {webhook.description && (
                                  <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                                    {webhook.description}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <div className="flex flex-col">
                                <span className="font-medium truncate max-w-[120px]">
                                  {workflowName}
                                </span>
                                <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                  {webhook.workflowId.slice(0, 8)}...
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 max-w-[200px]">
                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate flex-1">
                                  /{webhook.webhookPath.slice(0, 20)}...
                                </code>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopyUrl(webhook);
                                      }}
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Copy webhook URL</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm hidden lg:table-cell">
                              {formatDateTime(webhook.createdAt)}
                            </TableCell>
                            <TableCell>{renderStatusBadge(webhook.status)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1 md:gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="gap-1 h-8 px-2 md:px-3"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/webhooks/${webhook.id}/deliveries`);
                                      }}
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                      <span className="hidden md:inline">History</span>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View delivery history</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      aria-label="Regenerate URL"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRegeneratePath(webhook);
                                      }}
                                      disabled={isActionBusy(webhook.id)}
                                      className="h-8 w-8"
                                    >
                                      <RotateCw
                                        className={`h-4 w-4 ${isActionBusy(webhook.id) ? 'animate-spin' : ''}`}
                                      />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Regenerate webhook URL (old URL will stop working)
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Delete webhook"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(webhook);
                                      }}
                                      disabled={isActionBusy(webhook.id)}
                                      className="h-8 w-8"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete webhook</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : null}
                  {!isLoading && !hasData && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                          <Link2 className="h-10 w-10 text-muted-foreground" />
                          <p className="font-medium">No webhooks found</p>
                          <p className="text-sm text-muted-foreground max-w-lg">
                            Create your first webhook with the &quot;New webhook&quot; button or
                            tweak the filters above.&nbsp;
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
    </TooltipProvider>
  );
}
