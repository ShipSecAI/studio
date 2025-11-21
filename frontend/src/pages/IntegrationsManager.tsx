import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  ExternalLink,
  Plug,
  RefreshCcw,
  Trash2,
} from 'lucide-react'

import type { components } from '@shipsec/backend-client'
import { useIntegrationStore } from '@/store/integrationStore'
import { getCurrentUserId } from '@/lib/currentUser'
import { api } from '@/services/api'

type IntegrationProvider = components['schemas']['IntegrationProviderResponse']
type IntegrationConnection = components['schemas']['IntegrationConnectionResponse']

const GITHUB_APP_INSTALL_URL = import.meta.env.VITE_GITHUB_APP_INSTALL_URL || ''
const GITHUB_WEBHOOK_PATH = '/api/v1/webhooks/github/app'
const GITHUB_WEBHOOK_URL = `${window.location.origin}${GITHUB_WEBHOOK_PATH}`

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) {
    return '—'
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch (error) {
    console.error('Failed to format timestamp', error)
    return iso
  }
}

function getProviderConnection(
  providerId: string,
  connectionMap: Map<string, IntegrationConnection>,
): IntegrationConnection | undefined {
  return connectionMap.get(providerId)
}

export function IntegrationsManager() {
  const navigate = useNavigate()
  const location = useLocation()
  const userId = getCurrentUserId()
  const {
    providers,
    connections,
    fetchProviders,
    fetchConnections,
    refreshConnection,
    disconnect,
    upsertConnection,
    error,
    resetError,
    loadingProviders,
    loadingConnections,
  } = useIntegrationStore()
  const { toast } = useToast()

  const [configProvider, setConfigProvider] = useState<IntegrationProvider | null>(null)
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null)
  const [refreshingConnectionId, setRefreshingConnectionId] = useState<string | null>(null)
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null)
  const [customScopes, setCustomScopes] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchProviders().catch((err) => {
      console.error('Failed to load providers', err)
    })
  }, [fetchProviders])

  useEffect(() => {
    fetchConnections(userId).catch((err) => {
      console.error('Failed to load integrations', err)
    })
  }, [fetchConnections, userId])

  useEffect(() => {
    if (!error) {
      return
    }

    toast({
      title: 'Integration error',
      description: error,
      variant: 'destructive',
    })
  }, [error, toast])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const connectedProvider = params.get('connected')
    if (connectedProvider) {
      toast({
        title: 'Connection established',
        description: `Successfully connected to ${connectedProvider}.`,
      })
      params.delete('connected')  
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
    }
  }, [location.pathname, location.search, navigate, toast])

  const connectionByProvider = useMemo(() => {
    return new Map(connections.map((connection) => [connection.provider, connection]))
  }, [connections])

const parseAdditionalScopes = (input: string | undefined): string[] => {
  if (!input) {
    return []
  }
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  )
}

const buildRequestedScopes = (provider: IntegrationProvider): string[] => {
  const baseScopes = provider.defaultScopes ?? []
  const extraScopes = parseAdditionalScopes(customScopes[provider.id])
  return Array.from(new Set([...baseScopes, ...extraScopes]))
}

  const handleConnect = async (provider: IntegrationProvider) => {
    resetError()

    if (!provider.isConfigured) {
      setConfigProvider(provider)
      return
    }

    setConnectingProvider(provider.id)
    try {
      const redirectUri = `${window.location.origin}/integrations/callback/${provider.id}`
      const response = await api.integrations.startOAuth(provider.id, {
        userId,
        redirectUri,
        scopes: buildRequestedScopes(provider),
      })
      window.location.href = response.authorizationUrl
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start OAuth session'
      toast({
        title: 'Could not start OAuth flow',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setConnectingProvider(null)
    }
  }

  const handleConfigureProvider = (provider: IntegrationProvider) => {
    resetError()
    setConfigProvider(provider)
  }

  const handleRefresh = async (connection: IntegrationConnection) => {
    resetError()
    setRefreshingConnectionId(connection.id)
    try {
      await refreshConnection(connection.id, userId)
      toast({
        title: 'Token refreshed',
        description: `${connection.providerName} token has been refreshed.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh token'
      toast({
        title: 'Refresh failed',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setRefreshingConnectionId(null)
    }
  }

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(GITHUB_WEBHOOK_URL)
      toast({
        title: 'Webhook URL copied',
        description: GITHUB_WEBHOOK_URL,
      })
    } catch (err) {
      toast({
        title: 'Copy failed',
        description: err instanceof Error ? err.message : 'Could not copy webhook URL',
        variant: 'destructive',
      })
    }
  }

  const handleDisconnect = async (connection: IntegrationConnection) => {
    resetError()
    setDeletingConnectionId(connection.id)
    try {
      await disconnect(connection.id, userId)
      toast({
        title: 'Connection removed',
        description: `${connection.providerName} credentials have been deleted.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect'
      toast({
        title: 'Disconnect failed',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setDeletingConnectionId(null)
    }
  }

  const handleManualReconnect = (connection: IntegrationConnection) => {
    const provider = providers.find((item) => item.id === connection.provider)
    if (!provider) {
      toast({
        title: 'Provider unavailable',
        description: 'The provider is no longer configured.',
        variant: 'destructive',
      })
      return
    }
    handleConnect(provider)
  }

  const handleProviderConfigCompleted = (action: 'saved' | 'deleted', provider: IntegrationProvider) => {
    setConfigProvider(null)

    fetchProviders().catch((err) => {
      console.error('Failed to refresh providers', err)
    })

    const title =
      action === 'saved'
        ? `${provider.name} credentials saved`
        : `${provider.name} credentials removed`
    const description =
      action === 'saved'
        ? 'You can now start a new OAuth flow for this provider.'
        : 'The provider will now rely on environment credentials if available.'

    toast({
      title,
      description,
    })
  }

  const handleConnectionComplete = (connection: IntegrationConnection) => {
    upsertConnection(connection)
    toast({
      title: `${connection.providerName} connected`,
      description: 'Credentials stored successfully.',
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Connections</h1>
            <p className="text-sm text-muted-foreground">
              Manage OAuth tokens for external providers. Connections are encrypted and can be refreshed or revoked at any time.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/')}>Back to workflows</Button>
        </div>

        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Active connections</h2>
              <p className="text-sm text-muted-foreground">
                Tokens are refreshed automatically when possible. You can also refresh or disconnect manually.
              </p>
            </div>
          </div>

          {connections.length === 0 ? (
            <div className="border rounded-lg p-6 text-center bg-muted/30">
              <AlertCircle className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <h3 className="text-lg font-medium">No active connections yet</h3>
              <p className="text-sm text-muted-foreground">
                Connect a provider below to start using OAuth-protected APIs in your workflows.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Provider</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Scopes</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Expires</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {connections.map((connection) => {
                    const isRefreshing = refreshingConnectionId === connection.id
                    const isDeleting = deletingConnectionId === connection.id
                    const provider = providers.find((item) => item.id === connection.provider)
                    const canRefresh = connection.supportsRefresh && connection.hasRefreshToken

                    return (
                      <tr key={connection.id} className="bg-background">
                        <td className="px-4 py-3">
                          <div className="font-medium">{connection.providerName}</div>
                          <div className="text-xs text-muted-foreground">{connection.userId}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Badge
                            variant={connection.status === 'active' ? 'secondary' : 'destructive'}
                            className="uppercase tracking-wide"
                          >
                            {connection.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {connection.scopes.map((scope) => (
                              <Badge key={scope} variant="outline" className="text-[11px]">
                                {scope}
                              </Badge>
                            ))}
                            {connection.scopes.length === 0 && (
                              <span className="text-xs text-muted-foreground">(none)</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">
                          {formatTimestamp(connection.expiresAt ?? null)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-2"
                              disabled={isRefreshing || !canRefresh}
                              onClick={() => handleRefresh(connection)}
                            >
                              <RefreshCcw className="h-4 w-4" />
                              {isRefreshing ? 'Refreshing…' : 'Refresh'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-2"
                              disabled={isDeleting}
                              onClick={() => handleDisconnect(connection)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {isDeleting ? 'Removing…' : 'Remove'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => handleManualReconnect(connection)}
                              disabled={connectingProvider === connection.provider || !provider?.isConfigured}
                            >
                              <Plug className="h-4 w-4" />
                              Reconnect
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-card border rounded-lg p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">GitHub App (PR triggers)</h2>
              <p className="text-sm text-muted-foreground">
                Install the ShipSec GitHub App for webhooks and repo-scoped tokens. OAuth below remains for user-scoped calls.
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-2">
                <span className="font-medium">Webhook URL:</span>
                <code className="px-2 py-1 bg-muted rounded text-[11px]">{GITHUB_WEBHOOK_URL}</code>
                <Button variant="ghost" size="xs" className="h-6 px-2 gap-2" onClick={handleCopyWebhook}>
                  <Copy className="h-3 w-3" />
                  Copy
                </Button>
              </div>
            </div>
            <Button
              asChild
              disabled={!GITHUB_APP_INSTALL_URL}
              variant={GITHUB_APP_INSTALL_URL ? 'default' : 'secondary'}
              className="gap-2"
            >
              <a
                href={GITHUB_APP_INSTALL_URL || '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!GITHUB_APP_INSTALL_URL}
              >
                <ExternalLink className="h-4 w-4" />
                {GITHUB_APP_INSTALL_URL ? 'Install GitHub App' : 'Set VITE_GITHUB_APP_INSTALL_URL'}
              </a>
            </Button>
          </div>
          {!GITHUB_APP_INSTALL_URL && (
            <p className="text-xs text-muted-foreground">
              Set <code>VITE_GITHUB_APP_INSTALL_URL</code> to your app’s installation link to enable the button.
            </p>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Available providers</h2>
              <p className="text-sm text-muted-foreground">
                Connect a provider to issue OAuth tokens and reuse them across your workflows.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((provider) => {
              const connection = getProviderConnection(provider.id, connectionByProvider)
              const isConnecting = connectingProvider === provider.id
              const requestedScopes = buildRequestedScopes(provider)
              const additionalScopesValue = customScopes[provider.id] ?? ''
              const configuredBadge = provider.isConfigured ? (
                <Badge variant="secondary">Configured</Badge>
              ) : (
                <Badge variant="outline">Setup required</Badge>
              )

              return (
                <div
                  key={provider.id}
                  className="border rounded-lg p-5 bg-card flex flex-col gap-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold">{provider.name}</h3>
                      <p className="text-sm text-muted-foreground">{provider.description}</p>
                    </div>
                    {configuredBadge}
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {requestedScopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="text-[11px]">
                        {scope}
                      </Badge>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`additional-scopes-${provider.id}`} className="text-xs font-medium">
                      Additional scopes
                    </Label>
                    <Input
                      id={`additional-scopes-${provider.id}`}
                      value={additionalScopesValue}
                      placeholder="repo delete_repo"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          const normalized = parseAdditionalScopes(additionalScopesValue)
                          if (normalized.length > 0) {
                            setCustomScopes((prev) => ({
                              ...prev,
                              [provider.id]: normalized.join(' '),
                            }))
                            toast({
                              title: 'Scopes added',
                              description: `Queued ${normalized.join(', ')} for next connection attempt.`,
                            })
                          }
                        }
                      }}
                      onChange={(event) =>
                        setCustomScopes((prev) => ({
                          ...prev,
                          [provider.id]: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Separate scopes with spaces or commas. Press Enter to normalize them. Default scopes stay included automatically.
                    </p>
                  </div>

                  {connection ? (
                    <p className="text-xs text-muted-foreground">
                      Last updated {formatTimestamp(connection.updatedAt)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No active token stored for this provider.
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-auto">
                    <Button
                      onClick={() => handleConnect(provider)}
                      disabled={isConnecting}
                      className="gap-2"
                    >
                      <Plug className="h-4 w-4" />
                      {isConnecting ? 'Starting…' : connection ? 'Reconnect' : 'Connect'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={isConnecting}
                      onClick={() => handleConfigureProvider(provider)}
                    >
                      <KeyRound className="h-4 w-4" />
                      Manage credentials
                    </Button>
                    {provider.docsUrl && (
                      <Button
                        variant="ghost"
                        className="gap-2"
                        onClick={() => window.open(provider.docsUrl, '_blank', 'noopener noreferrer')}
                      >
                        <ExternalLink className="h-4 w-4" />
                        Docs
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {(loadingProviders || loadingConnections) && (
            <p className="text-sm text-muted-foreground mt-4">Loading provider catalog…</p>
          )}
        </section>
      </div>

      <ProviderConfigDialog
        provider={configProvider}
        open={configProvider !== null}
        onClose={() => setConfigProvider(null)}
        onCompleted={handleProviderConfigCompleted}
      />

      {/* Hidden portal slot to inject new connections from callback */}
      <IntegrationCallbackBridge onConnected={handleConnectionComplete} />
    </div>
  )
}

interface ProviderConfigDialogProps {
  provider: IntegrationProvider | null
  open: boolean
  onClose: () => void
  onCompleted: (action: 'saved' | 'deleted', provider: IntegrationProvider) => void
}

function ProviderConfigDialog({
  provider,
  open,
  onClose,
  onCompleted,
}: ProviderConfigDialogProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [hasStoredSecret, setHasStoredSecret] = useState(false)
  const [configuredBy, setConfiguredBy] = useState<'environment' | 'user'>('user')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedRedirect, setCopiedRedirect] = useState(false)

  const callbackUrl = provider ? `${window.location.origin}/integrations/callback/${provider.id}` : ''

  useEffect(() => {
    if (!open) {
      setClientSecret('')
      setError(null)
      setCopiedRedirect(false)
      return
    }

    if (!provider) {
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setClientId('')
    setClientSecret('')
    setHasStoredSecret(false)
    setConfiguredBy('user')
    setUpdatedAt(null)

    api.integrations
      .getProviderConfig(provider.id)
      .then((config) => {
        if (cancelled) {
          return
        }
        setClientId(config.clientId ?? '')
        setHasStoredSecret(config.hasClientSecret)
        setConfiguredBy(config.configuredBy)
        setUpdatedAt(config.updatedAt ?? null)
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        const message = err instanceof Error ? err.message : 'Failed to load provider configuration.'
        setError(message)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, provider?.id])

  useEffect(() => {
    setCopiedRedirect(false)
  }, [callbackUrl])

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose()
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!provider) {
      return
    }

    const trimmedClientId = clientId.trim()
    const trimmedSecret = clientSecret.trim()

    if (trimmedClientId.length === 0) {
      setError('Client ID is required.')
      return
    }

    if (!hasStoredSecret && trimmedSecret.length === 0) {
      setError('Client secret is required.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await api.integrations.upsertProviderConfig(provider.id, {
        clientId: trimmedClientId,
        ...(trimmedSecret.length > 0 ? { clientSecret: trimmedSecret } : {}),
      })
      onCompleted('saved', provider)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save provider credentials.'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!provider) {
      return
    }

    setSaving(true)
    setError(null)
    try {
      await api.integrations.deleteProviderConfig(provider.id)
      onCompleted('deleted', provider)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove stored credentials.'
      setError(message)
      setSaving(false)
    }
  }

  const canRemove = configuredBy === 'user' && hasStoredSecret
  const isBusy = loading || saving

  const handleCopyRedirect = async () => {
    if (!callbackUrl) {
      return
    }

    try {
      await navigator.clipboard.writeText(callbackUrl)
      setCopiedRedirect(true)
      setTimeout(() => setCopiedRedirect(false), 2000)
    } catch (err) {
      console.error('Failed to copy redirect URL', err)
      setError('Unable to copy redirect URL. Please copy it manually.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {provider ? `Configure ${provider.name}` : 'Configure provider'}
          </DialogTitle>
          <DialogDescription>
            Provide the OAuth client credentials required to start authorization flows for this provider.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {configuredBy === 'environment' && (
            <p className="text-xs text-muted-foreground">
              This provider currently uses credentials from the server environment. Saving values here will override them for ShipSec Studio.
            </p>
          )}

          {loading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading current configuration…
            </p>
          )}

          {updatedAt && (
            <p className="text-xs text-muted-foreground">
              Last updated {formatTimestamp(updatedAt)}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="provider-client-id">OAuth client ID</Label>
            <Input
              id="provider-client-id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="e.g. github-client-id"
              autoComplete="off"
              disabled={isBusy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-client-secret">OAuth client secret</Label>
            <Input
              id="provider-client-secret"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={hasStoredSecret ? 'Leave blank to keep existing secret' : 'Enter new client secret'}
              type="password"
              autoComplete="off"
              disabled={isBusy}
            />
          </div>

          {callbackUrl && (
            <div className="space-y-2">
              <Label htmlFor="provider-callback-url">Authorized redirect URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="provider-callback-url"
                  value={callbackUrl}
                  readOnly
                  className="sm:flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyRedirect}
                  className="gap-2"
                >
                  {copiedRedirect ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedRedirect ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Add this exact URL to the provider&apos;s allowed redirect list to avoid callback warnings.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2 sm:justify-between sm:flex-row">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {canRemove && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={isBusy}
                >
                  Remove stored credentials
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
                Cancel
              </Button>
              <Button type="submit" disabled={isBusy}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save credentials'
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface IntegrationCallbackBridgeProps {
  onConnected: (connection: IntegrationConnection) => void
}

function IntegrationCallbackBridge({ onConnected }: IntegrationCallbackBridgeProps) {
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<IntegrationConnection>).detail
      if (detail) {
        onConnected(detail)
      }
    }

    window.addEventListener('integration:connected', listener)
    return () => {
      window.removeEventListener('integration:connected', listener)
    }
  }, [onConnected])

  return null
}
