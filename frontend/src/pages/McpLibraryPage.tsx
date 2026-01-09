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

function HealthIndicator({ status }: { status: McpHealthStatus | null }) {
  const statusConfig = {
    healthy: { icon: CheckCircle2, color: 'text-green-500', label: 'Healthy' },
    unhealthy: { icon: AlertCircle, color: 'text-red-500', label: 'Unhealthy' },
    unknown: { icon: HelpCircle, color: 'text-gray-400', label: 'Unknown' },
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
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false)
  const [selectedServerForTools, setSelectedServerForTools] = useState<string | null>(null)
  const [jsonValue, setJsonValue] = useState('')
  const [jsonParseError, setJsonParseError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [activeTab, setActiveTab] = useState<'manual' | 'json'>('manual')

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
  } = useMcpServerStore()

  // Enable health polling on this page
  useMcpHealthPolling(15_000, true)

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

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

  // Generate Claude Code style JSON from form data
  const formDataToJson = (data: ServerFormData): string => {
    const serverConfig: Record<string, unknown> = {}

    if (data.transportType === 'stdio') {
      serverConfig.command = data.command
      if (data.args.trim()) {
        serverConfig.args = data.args.split('\n').map(a => a.trim()).filter(Boolean)
      }
    } else {
      serverConfig.url = data.endpoint
    }

    if (data.headers.trim()) {
      try {
        serverConfig.headers = JSON.parse(data.headers)
      } catch {
        // Keep as string if invalid JSON
        serverConfig.headers = data.headers
      }
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
    setJsonValue(formDataToJson(editFormData))
    setJsonParseError(null)
    setActiveTab('manual')
    setEditorOpen(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
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
        headers: formData.headers.trim()
          ? JSON.parse(formData.headers)
          : undefined,
        healthCheckUrl: formData.healthCheckUrl.trim() || undefined,
        enabled: formData.enabled,
      }

      if (editingServer) {
        await updateServer(editingServer, payload)
        toast({ title: 'Server updated', description: `${payload.name} has been updated.` })
      } else {
        await createServer(payload)
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

      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

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
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredServers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
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
                    <HealthIndicator status={healthStatus[server.id] ?? null} />
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

              <div className="space-y-2">
                <Label htmlFor="headers">Headers (JSON)</Label>
                <Textarea
                  id="headers"
                  value={formData.headers}
                  onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                  placeholder='{"Authorization": "Bearer xxx"}'
                  rows={3}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {editingServer
                    ? 'Leave empty to keep existing headers, or enter new JSON to replace.'
                    : 'Optional authentication headers in JSON format.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="enabled"
                  checked={formData.enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                />
                <Label htmlFor="enabled">Enabled</Label>
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
              These are the tools discovered from this MCP server.
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
                  <div key={tool.id} className="border rounded-lg p-3">
                    <div className="font-medium">{tool.toolName}</div>
                    {tool.description && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {tool.description}
                      </div>
                    )}
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
