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
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Search,
  Plus,
  Trash2,
  Edit3,
  RefreshCw,
  Plug,
  Wrench,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  FileJson,
} from 'lucide-react'
import { useMcpServerStore } from '@/store/mcpServerStore'
import { useMcpHealthPolling } from '@/hooks/useMcpHealthPolling'
import { useToast } from '@/components/ui/use-toast'
import type { McpHealthStatus, CreateMcpServer } from '@shipsec/shared'
import { cn } from '@/lib/utils'

const TRANSPORT_TYPES = [
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'SSE' },
  { value: 'websocket', label: 'WebSocket' },
  { value: 'stdio', label: 'stdio (Local)' },
] as const

type TransportType = (typeof TRANSPORT_TYPES)[number]['value']

function HealthIndicator({ status, checking }: { status: McpHealthStatus | null, checking?: boolean }) {
  const statusConfig = {
    healthy: { icon: CheckCircle2, color: 'text-green-500', label: 'Healthy' },
    unhealthy: { icon: AlertCircle, color: 'text-red-500', label: 'Unhealthy' },
    unknown: { icon: HelpCircle, color: 'text-gray-400', label: 'Unknown' },
  }

  if (checking) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
              <span className="text-xs text-muted-foreground">Checking...</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Checking server status...</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const config = statusConfig[status ?? 'unknown']
  const Icon = config.icon

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className="flex items-center gap-1.5">
            <Icon className={cn('h-4 w-4', config.color)} />
            <span className="text-xs text-muted-foreground">{config.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Server status: {config.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function TransportBadge({ type }: { type: TransportType }) {
  const variants: Record<TransportType, 'default' | 'secondary' | 'outline'> = {
    http: 'default',
    sse: 'secondary',
    websocket: 'secondary',
    stdio: 'outline',
  }

  return (
    <Badge variant={variants[type]} className="text-xs">
      {type.toUpperCase()}
    </Badge>
  )
}

interface ServerFormData {
  name: string
  description: string
  transportType: TransportType
  endpoint: string
  command: string
  args: string
  headers: string
  healthCheckUrl: string
  enabled: boolean
}

interface HeaderEntry {
  key: string
  value: string
  isStored: boolean // True if this key came from backend (value is encrypted)
}

const INITIAL_FORM_DATA: ServerFormData = {
  name: '',
  description: '',
  transportType: 'http',
  endpoint: '',
  command: '',
  args: '',
  headers: '',
  healthCheckUrl: '',
  enabled: true,
}

export function McpLibraryPage() {
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [formData, setFormData] = useState<ServerFormData>(INITIAL_FORM_DATA)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [testingServer, setTestingServer] = useState<string | null>(null)
  const [checkingServers, setCheckingServers] = useState<Set<string>>(new Set())
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const [selectedServerForTools, setSelectedServerForTools] = useState<string | null>(null)
  const [jsonValue, setJsonValue] = useState('')
  const [jsonParseError, setJsonParseError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [activeTab, setActiveTab] = useState<'manual' | 'json'>('manual')
  const [headerEntries, setHeaderEntries] = useState<HeaderEntry[]>([])

  const {
    servers,
    tools,
    healthStatus,
    isLoading,
    error,
    fetchServers,
    createServer,
    updateServer,
    deleteServer,
    toggleServer,
    testConnection,
    fetchServerTools,
    fetchAllTools,
    toggleTool,
    refreshHealth,
  } = useMcpServerStore()

  // Enable health polling on this page
  useMcpHealthPolling(15_000, true)

  useEffect(() => {
    fetchServers()
    fetchAllTools()
  }, [fetchServers, fetchAllTools])

  // Run health checks for ALL servers on page load
  useEffect(() => {
    if (servers.length > 0) {
      // Health check all servers in parallel (don't await, let them run in background)
      const serverIds = servers.map(s => s.id)
      setCheckingServers(new Set(serverIds))
      Promise.allSettled(
        serverIds.map((serverId) =>
          testConnection(serverId).catch(() => {
            // Silently ignore individual health check errors
          })
        )
      )
        .then(async () => {
          // Refresh health status in store after all checks complete
          await refreshHealth()
        })
        .finally(() => {
          setCheckingServers(new Set())
        })
    }
  }, [servers.length]) // Only re-run when server count changes

  // Sync JSON config to Manual form when valid single-server JSON is entered
  useEffect(() => {
    if (!jsonValue.trim() || editingServer) return

    const { servers: parsedServers, error } = parseClaudeCodeConfig(jsonValue)
    if (error || parsedServers.length !== 1) return

    // Only sync if JSON tab is active and the form data differs
    const parsedConfig = parsedServers[0].config
    if (activeTab === 'json' && parsedConfig.name !== formData.name) {
      setFormData(parsedConfig)
    }
  }, [jsonValue, activeTab, editingServer]) // eslint-disable-line react-hooks/exhaustive-deps

  // Populate header entries when editing a server
  useEffect(() => {
    if (editingServer) {
      const server = servers.find(s => s.id === editingServer)
      if (server?.headerKeys && server.headerKeys.length > 0) {
        setHeaderEntries(
          server.headerKeys.map(key => ({ key, value: '', isStored: true }))
        )
      } else {
        setHeaderEntries([])
      }
    } else {
      // Reset when creating new server
      setHeaderEntries([])
    }
  }, [editingServer, servers])

  // Header entry management functions
  const addHeaderEntry = () => {
    setHeaderEntries(prev => [...prev, { key: '', value: '', isStored: false }])
  }

  const updateHeaderEntry = (index: number, field: 'key' | 'value', value: string) => {
    setHeaderEntries(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      // If user starts typing in a stored entry's value, mark it as being edited
      if (field === 'value' && updated[index].isStored && value) {
        // Keep isStored true but value will indicate replacement
      }
      return updated
    })
  }

  const removeHeaderEntry = (index: number) => {
    setHeaderEntries(prev => prev.filter((_, i) => i !== index))
  }

  const filteredServers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return servers

    return servers.filter(
      (server) =>
        server.name.toLowerCase().includes(query) ||
        server.description?.toLowerCase().includes(query) ||
        server.endpoint?.toLowerCase().includes(query)
    )
  }, [servers, searchQuery])

  // Calculate tool counts per server (enabled/total)
  const toolCountsByServer = useMemo(() => {
    const counts: Record<string, { enabled: number; total: number }> = {}
    for (const server of servers) {
      const serverTools = tools.filter((t) => t.serverId === server.id)
      counts[server.id] = {
        enabled: serverTools.filter((t) => t.enabled).length,
        total: serverTools.length,
      }
    }
    return counts
  }, [servers, tools])

  // Generate Claude Code style JSON from form data (for JSON tab display)
  const formDataToJson = (data: ServerFormData, serverHeaderKeys?: string[] | null): string => {
    const serverConfig: Record<string, unknown> = {}

    if (data.transportType === 'stdio') {
      serverConfig.command = data.command
      if (data.args.trim()) {
        serverConfig.args = data.args.split('\n').map(a => a.trim()).filter(Boolean)
      }
    } else {
      serverConfig.url = data.endpoint
    }

    // Show existing header keys with masked values, plus any new headers from form
    const headersToShow: Record<string, string> = {}

    // Add existing headers with masked values
    if (serverHeaderKeys && serverHeaderKeys.length > 0) {
      for (const key of serverHeaderKeys) {
        headersToShow[key] = '****'
      }
    }

    // Add/override with new header entries that have values
    for (const entry of headerEntries) {
      if (entry.key.trim()) {
        if (entry.value.trim()) {
          headersToShow[entry.key] = '****' // Mask new values too in JSON view
        } else if (entry.isStored) {
          headersToShow[entry.key] = '****'
        }
      }
    }

    if (Object.keys(headersToShow).length > 0) {
      serverConfig.headers = headersToShow
    }

    return JSON.stringify({
      mcpServers: {
        [data.name || 'server']: serverConfig
      }
    }, null, 2)
  }

  const handleCreateNew = () => {
    setEditingServer(null)
    setFormData(INITIAL_FORM_DATA)
    setJsonValue('')
    setJsonParseError(null)
    setActiveTab('manual')
    setEditorOpen(true)
  }

  const handleEdit = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (!server) return

    setEditingServer(serverId)
    const editFormData: ServerFormData = {
      name: server.name,
      description: server.description ?? '',
      transportType: server.transportType,
      endpoint: server.endpoint ?? '',
      command: server.command ?? '',
      args: server.args?.join('\n') ?? '',
      headers: '', // Never show existing headers
      healthCheckUrl: '',
      enabled: server.enabled,
    }
    setFormData(editFormData)
    setJsonValue(formDataToJson(editFormData, server.headerKeys))
    setJsonParseError(null)
    setActiveTab('manual')
    setEditorOpen(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Build headers from headerEntries - only include entries with new values
      const headersPayload = headerEntries
        .filter(e => e.key.trim() && e.value.trim()) // Only entries with key AND new value
        .reduce((acc, entry) => {
          acc[entry.key.trim()] = entry.value.trim()
          return acc
        }, {} as Record<string, string>)

      const payload: CreateMcpServer = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        transportType: formData.transportType,
        endpoint: ['http', 'sse', 'websocket'].includes(formData.transportType)
          ? formData.endpoint.trim()
          : undefined,
        command: formData.transportType === 'stdio' ? formData.command.trim() : undefined,
        args: formData.transportType === 'stdio' && formData.args.trim()
          ? formData.args.split('\n').map((a) => a.trim()).filter(Boolean)
          : undefined,
        headers: Object.keys(headersPayload).length > 0 ? headersPayload : undefined,
        enabled: true, // Always enabled on create, can toggle from list
      }

      if (editingServer) {
        // Mark as checking BEFORE the update to prevent "Unknown" flash
        setCheckingServers((prev) => new Set([...prev, editingServer]))
        await updateServer(editingServer, payload)
        // Run health check after update to refresh status and tools
        testConnection(editingServer)
          .then(async () => {
            // Fetch all tools after health check to update tool counts
            await fetchAllTools()
            // Refresh health status in store before clearing checking state
            await refreshHealth()
          })
          .catch(() => {
            // Silently ignore health check errors on update
          })
          .finally(() => {
            setCheckingServers((prev) => {
              const next = new Set(prev)
              next.delete(editingServer)
              return next
            })
          })
        toast({ title: 'Server updated', description: `${payload.name} has been updated.` })
      } else {
        const newServer = await createServer(payload)
        // Immediately add to checking set - batched with store update to prevent "Unknown" flash
        setCheckingServers((prev) => new Set([...prev, newServer.id]))
        // Run health check to set status and discover tools
        testConnection(newServer.id)
          .then(async (result) => {
            // Fetch all tools after health check to update tool counts
            await fetchAllTools()
            // Refresh health status in store before clearing checking state
            await refreshHealth()
            if (result.toolCount !== undefined && result.toolCount > 0) {
              toast({
                title: 'Server ready',
                description: `Discovered ${result.toolCount} tool(s) from ${payload.name}.`,
              })
            }
          })
          .catch(() => {
            // Silently ignore health check errors
          })
          .finally(() => {
            setCheckingServers((prev) => {
              const next = new Set(prev)
              next.delete(newServer.id)
              return next
            })
          })
        toast({ title: 'Server created', description: `${payload.name} has been added.` })
      }

      setEditorOpen(false)
      setEditingServer(null)
      setFormData(INITIAL_FORM_DATA)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save server',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!serverToDelete) return

    setIsDeleting(true)
    try {
      await deleteServer(serverToDelete)
      toast({ title: 'Server deleted', description: 'MCP server has been removed.' })
      setDeleteDialogOpen(false)
      setServerToDelete(null)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete server',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleToggle = async (serverId: string) => {
    try {
      const server = await toggleServer(serverId)
      toast({
        title: server.enabled ? 'Server enabled' : 'Server disabled',
        description: `${server.name} has been ${server.enabled ? 'enabled' : 'disabled'}.`,
      })
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to toggle server',
        variant: 'destructive',
      })
    }
  }

  const handleTestConnection = async (serverId: string) => {
    setTestingServer(serverId)
    try {
      const result = await testConnection(serverId)
      toast({
        title: result.success ? 'Connection successful' : 'Connection failed',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      })
    } catch (err) {
      toast({
        title: 'Test failed',
        description: err instanceof Error ? err.message : 'Connection test failed',
        variant: 'destructive',
      })
    } finally {
      setTestingServer(null)
    }
  }

  const handleViewTools = async (serverId: string) => {
    setSelectedServerForTools(serverId)
    setToolsDialogOpen(true)
    await fetchServerTools(serverId)
  }

  const handleToggleTool = async (serverId: string, toolId: string) => {
    try {
      const tool = await toggleTool(serverId, toolId)
      toast({
        title: tool.enabled ? 'Tool enabled' : 'Tool disabled',
        description: `${tool.toolName} has been ${tool.enabled ? 'enabled' : 'disabled'}.`,
      })
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to toggle tool',
        variant: 'destructive',
      })
    }
  }

  // Parse Claude Code style JSON config
  const parseClaudeCodeConfig = (jsonString: string): {
    servers: Array<{ name: string; config: ServerFormData }>;
    error?: string
  } => {
    try {
      const parsed = JSON.parse(jsonString)

      // Validate structure - support both { mcpServers: {...} } and direct server config
      let mcpServers: Record<string, unknown>

      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        mcpServers = parsed.mcpServers
      } else if (parsed.url || parsed.command) {
        // Direct single server config without name
        mcpServers = { 'Imported Server': parsed }
      } else {
        return { servers: [], error: 'Invalid config: expected mcpServers object or server config with url/command' }
      }

      const servers: Array<{ name: string; config: ServerFormData }> = []

      for (const [name, config] of Object.entries(mcpServers)) {
        const serverConfig = config as {
          url?: string
          headers?: Record<string, string>
          command?: string
          args?: string[]
        }

        // Determine transport type based on config
        let transportType: TransportType = 'http'
        if (serverConfig.command) {
          transportType = 'stdio'
        } else if (serverConfig.url) {
          // Check URL for transport hints
          const url = serverConfig.url.toLowerCase()
          if (url.includes('/sse') || url.endsWith('/events')) {
            transportType = 'sse'
          } else if (url.startsWith('ws://') || url.startsWith('wss://')) {
            transportType = 'websocket'
          }
        }

        servers.push({
          name,
          config: {
            name,
            description: '',
            transportType,
            endpoint: serverConfig.url ?? '',
            command: serverConfig.command ?? '',
            args: serverConfig.args?.join('\n') ?? '',
            headers: serverConfig.headers ? JSON.stringify(serverConfig.headers, null, 2) : '',
            healthCheckUrl: '', // Will default to endpoint
            enabled: true,
          },
        })
      }

      return { servers }
    } catch (e) {
      return { servers: [], error: e instanceof Error ? `JSON parse error: ${e.message}` : 'Invalid JSON' }
    }
  }

  // Handle saving from JSON tab (parses JSON and saves)
  const handleJsonSave = async () => {
    const { servers, error } = parseClaudeCodeConfig(jsonValue)

    if (error) {
      setJsonParseError(error)
      return
    }

    if (servers.length === 0) {
      setJsonParseError('No servers found in config')
      return
    }

    // When editing, update the server with the parsed config
    if (editingServer) {
      const firstServer = servers[0].config
      setIsSaving(true)
      try {
        const payload: CreateMcpServer = {
          name: formData.name.trim(), // Keep original name
          description: firstServer.description.trim() || undefined,
          transportType: firstServer.transportType,
          endpoint: ['http', 'sse', 'websocket'].includes(firstServer.transportType)
            ? firstServer.endpoint.trim() || undefined
            : undefined,
          command: firstServer.transportType === 'stdio' ? firstServer.command.trim() || undefined : undefined,
          args: firstServer.transportType === 'stdio' && firstServer.args.trim()
            ? firstServer.args.split('\n').map((a) => a.trim()).filter(Boolean)
            : undefined,
          headers: firstServer.headers.trim() ? JSON.parse(firstServer.headers) : undefined,
          enabled: formData.enabled,
        }
        await updateServer(editingServer, payload)
        toast({ title: 'Server updated', description: `${payload.name} has been updated.` })
        setEditorOpen(false)
        setEditingServer(null)
        setFormData(INITIAL_FORM_DATA)
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to save server',
          variant: 'destructive',
        })
      } finally {
        setIsSaving(false)
      }
      return
    }

    // When adding new, batch create all servers
    setIsImporting(true)
    setJsonParseError(null)

    try {
      const results = await Promise.allSettled(
        servers.map(({ config }) => {
          const payload: CreateMcpServer = {
            name: config.name.trim(),
            description: config.description.trim() || undefined,
            transportType: config.transportType,
            endpoint: ['http', 'sse', 'websocket'].includes(config.transportType)
              ? config.endpoint.trim() || undefined
              : undefined,
            command: config.transportType === 'stdio' ? config.command.trim() || undefined : undefined,
            args: config.transportType === 'stdio' && config.args.trim()
              ? config.args.split('\n').map((a) => a.trim()).filter(Boolean)
              : undefined,
            headers: config.headers.trim() ? JSON.parse(config.headers) : undefined,
            enabled: true,
          }
          return createServer(payload)
        })
      )

      // Extract successfully created servers
      type ServerResponse = Awaited<ReturnType<typeof createServer>>
      const createdServers = results
        .filter((r): r is PromiseFulfilledResult<ServerResponse> => r.status === 'fulfilled')
        .map((r) => r.value)

      const succeeded = createdServers.length
      const failed = results.filter((r) => r.status === 'rejected').length

      // Mark all created servers as checking to prevent "Unknown" flash
      if (createdServers.length > 0) {
        setCheckingServers(new Set(createdServers.map((s) => s.id)))

        // Run health checks in parallel to discover tools (non-blocking)
        Promise.allSettled(
          createdServers.map((server) => testConnection(server.id).catch(() => {}))
        )
          .then(async () => {
            // Fetch all tools after health checks complete
            await fetchAllTools()
            // Refresh health status in store before clearing checking state
            await refreshHealth()
          })
          .finally(() => {
            // Clear checking state for all created servers
            setCheckingServers((prev) => {
              const next = new Set(prev)
              createdServers.forEach((s) => next.delete(s.id))
              return next
            })
          })
      }

      if (failed > 0) {
        toast({
          title: 'Partial import',
          description: `Created ${succeeded} server(s), ${failed} failed`,
          variant: succeeded > 0 ? 'default' : 'destructive',
        })
      } else {
        toast({
          title: 'Import successful',
          description: `Created ${succeeded} MCP server(s)`,
        })
      }

      setEditorOpen(false)
      setJsonValue('')
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Failed to import servers',
        variant: 'destructive',
      })
    } finally {
      setIsImporting(false)
    }
  }

  const serverTools = useMemo(() => {
    if (!selectedServerForTools) return []
    return tools.filter((t) => t.serverId === selectedServerForTools)
  }, [tools, selectedServerForTools])

  const selectedServer = useMemo(() => {
    if (!selectedServerForTools) return null
    return servers.find((s) => s.id === selectedServerForTools)
  }, [servers, selectedServerForTools])

  if (error) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Failed to load MCP servers</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => fetchServers({ force: true })}>Try again</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">MCP Library</h1>
          <p className="text-muted-foreground">
            Configure Model Context Protocol servers for AI agents
          </p>
        </div>
        <Button onClick={handleCreateNew}>
          <Plus className="h-4 w-4 mr-2" />
          Add Server
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => fetchServers({ force: true })}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Name</TableHead>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[80px] text-center">Tools</TableHead>
              <TableHead className="w-[100px] text-center">Enabled</TableHead>
              <TableHead className="w-[180px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && servers.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredServers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <Plug className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {searchQuery ? 'No servers match your search' : 'No MCP servers configured'}
                  </p>
                  {!searchQuery && (
                    <Button variant="outline" className="mt-4" onClick={handleCreateNew}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add your first server
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredServers.map((server) => (
                <TableRow key={server.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{server.name}</div>
                      {server.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {server.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <TransportBadge type={server.transportType} />
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground truncate max-w-[300px]">
                    {server.endpoint ?? server.command ?? '—'}
                  </TableCell>
                  <TableCell>
                    <HealthIndicator status={healthStatus[server.id] ?? null} checking={checkingServers.has(server.id)} />
                  </TableCell>
                  <TableCell className="text-center">
                    {toolCountsByServer[server.id]?.total > 0 ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className="font-mono text-xs">
                              {toolCountsByServer[server.id].enabled}/{toolCountsByServer[server.id].total}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{toolCountsByServer[server.id].enabled} enabled out of {toolCountsByServer[server.id].total} tools</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={() => handleToggle(server.id)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleViewTools(server.id)}
                            >
                              <Wrench className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View tools</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTestConnection(server.id)}
                              disabled={testingServer === server.id}
                            >
                              <Plug className={cn('h-4 w-4', testingServer === server.id && 'animate-pulse')} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Test connection</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(server.id)}
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setServerToDelete(server.id)
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Server Editor Sheet */}
      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editingServer ? 'Edit MCP Server' : 'Add MCP Server'}
            </SheetTitle>
            <SheetDescription>
              Configure an MCP server that AI agents can use to access tools.
            </SheetDescription>
          </SheetHeader>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'manual' | 'json')}
            className="mt-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual</TabsTrigger>
              <TabsTrigger value="json">
                <FileJson className="h-4 w-4 mr-2" />
                JSON
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My MCP Server"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="transportType">Transport Type *</Label>
                <Select
                  value={formData.transportType}
                  onValueChange={(value) =>
                    setFormData({ ...formData, transportType: value as TransportType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSPORT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {['http', 'sse', 'websocket'].includes(formData.transportType) && (
                <div className="space-y-2">
                  <Label htmlFor="endpoint">Endpoint URL *</Label>
                  <Input
                    id="endpoint"
                    value={formData.endpoint}
                    onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                    placeholder="https://mcp.example.com/mcp"
                  />
                </div>
              )}

              {formData.transportType === 'stdio' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="command">Command *</Label>
                    <Input
                      id="command"
                      value={formData.command}
                      onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                      placeholder="npx"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="args">Arguments (one per line)</Label>
                    <Textarea
                      id="args"
                      value={formData.args}
                      onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                      placeholder="-y&#10;@modelcontextprotocol/server-everything"
                      rows={3}
                    />
                  </div>
                </>
              )}

              <div className="space-y-3">
                <Label>Headers</Label>
                {headerEntries.length > 0 ? (
                  <div className="space-y-2">
                    {headerEntries.map((entry, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <Input
                          value={entry.key}
                          onChange={(e) => updateHeaderEntry(index, 'key', e.target.value)}
                          placeholder="Header name"
                          className="flex-1 font-mono text-sm"
                          disabled={entry.isStored}
                        />
                        <div className="relative flex-1">
                          <Input
                            type="password"
                            value={entry.isStored && !entry.value ? '••••••••' : entry.value}
                            onChange={(e) => updateHeaderEntry(index, 'value', e.target.value)}
                            placeholder={entry.isStored ? 'Enter new value to replace' : 'Value'}
                            className="font-mono text-sm pr-10"
                            readOnly={entry.isStored && !entry.value}
                            onFocus={(e) => {
                              if (entry.isStored && !entry.value) {
                                e.target.readOnly = false
                                e.target.value = ''
                              }
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeHeaderEntry(index)}
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    No headers configured. Add headers for authentication.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addHeaderEntry}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Header
                </Button>
                <p className="text-xs text-muted-foreground">
                  {editingServer && headerEntries.some(e => e.isStored)
                    ? 'Existing header values are encrypted. Enter a new value to replace.'
                    : 'Headers are securely encrypted when stored.'}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setEditorOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving || !formData.name.trim()}>
                  {isSaving ? 'Saving...' : editingServer ? 'Update' : 'Create'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="json" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>{editingServer ? 'Server Configuration (JSON)' : 'Paste JSON Config'}</Label>
                <Textarea
                  value={jsonValue}
                  onChange={(e) => {
                    setJsonValue(e.target.value)
                    setJsonParseError(null)
                  }}
                  placeholder={`{
  "mcpServers": {
    "server-name": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer xxx"
      }
    }
  }
}`}
                  rows={14}
                  className="font-mono text-sm"
                />
                {jsonParseError && (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{jsonParseError}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {editingServer
                    ? 'Edit the JSON configuration and save.'
                    : 'Paste Claude Code config format. Multiple servers will be created.'}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setEditorOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleJsonSave}
                  disabled={(editingServer ? isSaving : isImporting) || !jsonValue.trim()}
                >
                  {editingServer
                    ? (isSaving ? 'Saving...' : 'Update')
                    : (isImporting ? 'Creating...' : 'Create')}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete MCP Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this server? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tools Dialog */}
      <Dialog open={toolsDialogOpen} onOpenChange={setToolsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Tools from {selectedServer?.name ?? 'Server'}
            </DialogTitle>
            <DialogDescription>
              {serverTools.length > 0 ? (
                <span className="flex items-center gap-2 mt-1">
                  Enabled: {serverTools.filter((t) => t.enabled).length} / {serverTools.length}
                </span>
              ) : (
                'These are the tools discovered from this MCP server.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {serverTools.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Wrench className="h-8 w-8 mx-auto mb-2" />
                <p>No tools discovered yet.</p>
                <p className="text-sm">Run a test connection to discover available tools.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {serverTools.map((tool) => (
                  <div key={tool.id} className={cn(
                    "border rounded-lg p-3 transition-opacity",
                    !tool.enabled && "opacity-60"
                  )}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{tool.toolName}</div>
                        {tool.description && (
                          <div className="text-sm text-muted-foreground mt-1">
                            {tool.description}
                          </div>
                        )}
                      </div>
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={() => handleToggleTool(tool.serverId, tool.id)}
                      />
                    </div>
                    {tool.inputSchema && (
                      <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default McpLibraryPage
