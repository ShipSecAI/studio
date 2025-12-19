import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, Search, Copy, ExternalLink } from 'lucide-react'
import { useArtifactStore } from '@/store/artifactStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ArtifactMetadata } from '@shipsec/shared'
import { Badge } from '@/components/ui/badge'
import { getRemoteUploads } from '@/utils/artifacts'

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, index)
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

const formatTimestamp = (value: string) => {
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export function ArtifactLibrary() {
  const [searchQuery, setSearchQuery] = useState('')
  const { library, libraryLoading, libraryError, fetchLibrary, downloadArtifact, downloading } =
    useArtifactStore()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedRemoteUri, setCopiedRemoteUri] = useState<string | null>(null)

  const handleCopy = useCallback(async (artifactId: string) => {
    try {
      await navigator.clipboard.writeText(artifactId)
      setCopiedId(artifactId)
      setTimeout(() => {
        setCopiedId((current) => (current === artifactId ? null : current))
      }, 2000)
    } catch (error) {
      console.error('Failed to copy artifact ID', error)
    }
  }, [])

  useEffect(() => {
    void fetchLibrary()
  }, [fetchLibrary])

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void fetchLibrary({
      search: searchQuery.trim() || undefined,
    })
  }

  const handleRefresh = () => {
    void fetchLibrary({
      search: searchQuery.trim() || undefined,
    })
  }

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <div className="mb-4 md:mb-8">
          <p className="text-sm md:text-base text-muted-foreground">
            Browse artifacts saved across workflow runs and reuse them in new automations.
          </p>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4 md:mb-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search artifacts..."
                  className="pl-8 w-full sm:w-auto"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" variant="secondary" disabled={libraryLoading} className="flex-shrink-0">
                Search
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              onClick={handleRefresh}
              disabled={libraryLoading}
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-3 md:mx-0 px-3 md:px-0">
          {libraryLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading artifacts…
          </div>
        ) : libraryError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-destructive">
            <span>{libraryError}</span>
            <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
              Try again
            </Button>
          </div>
        ) : library.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <span>No artifacts found.</span>
            <p className="text-center text-xs text-muted-foreground">
              Run workflows with artifact saving enabled to populate this library.
            </p>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm min-w-[600px]">
            <thead className="sticky top-0 bg-background shadow-sm">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 md:px-6 py-3 font-medium min-w-[150px]">Name</th>
                <th className="px-3 md:px-4 py-3 font-medium min-w-[100px] hidden sm:table-cell">Run</th>
                <th className="px-3 md:px-4 py-3 font-medium min-w-[100px] hidden md:table-cell">Component</th>
                <th className="px-3 md:px-4 py-3 font-medium min-w-[60px]">Size</th>
                <th className="px-3 md:px-4 py-3 font-medium min-w-[100px] hidden lg:table-cell">Created</th>
                <th className="px-3 md:px-4 py-3 font-medium min-w-[120px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {library.map((artifact) => (
                <ArtifactLibraryRow
                  key={artifact.id}
                  artifact={artifact}
                  onDownload={() => downloadArtifact(artifact)}
                  onCopy={() => handleCopy(artifact.id)}
                  copied={copiedId === artifact.id}
                  onCopyRemoteUri={async (uri: string) => {
                    try {
                      await navigator.clipboard.writeText(uri)
                      setCopiedRemoteUri(uri)
                      setTimeout(() => {
                        setCopiedRemoteUri((current) => (current === uri ? null : current))
                      }, 2000)
                    } catch (error) {
                      console.error('Failed to copy remote URI', error)
                    }
                  }}
                  copiedRemoteUri={copiedRemoteUri}
                  isDownloading={Boolean(downloading[artifact.id])}
                />
              ))}
            </tbody>
          </table>
        )}
        </div>
      </div>
    </div>
  )
}

function ArtifactLibraryRow({
  artifact,
  onDownload,
  onCopy,
  copied,
  onCopyRemoteUri,
  copiedRemoteUri,
  isDownloading,
}: {
  artifact: ArtifactMetadata
  onDownload: () => void
  onCopy: () => void
  copied: boolean
  onCopyRemoteUri: (uri: string) => void
  copiedRemoteUri: string | null
  isDownloading: boolean
}) {
  const remoteUploads = getRemoteUploads(artifact)

  return (
    <tr className="border-b last:border-none">
      <td className="px-3 md:px-6 py-3 md:py-4 align-top">
        <div className="font-medium truncate max-w-[150px] md:max-w-none">{artifact.name}</div>
        <div className="text-[10px] md:text-xs text-muted-foreground font-mono truncate max-w-[150px] md:max-w-none">{artifact.id}</div>
        {remoteUploads.length > 0 && (
          <div className="mt-2 space-y-1 hidden md:block">
            {remoteUploads.map((remote) => (
              <div
                key={`${artifact.id}-${remote.uri}`}
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <Badge variant="outline" className="text-[10px] uppercase">
                  {remote.type}
                </Badge>
                <code className="max-w-[180px] lg:max-w-[240px] truncate font-mono text-[11px]">
                  {remote.uri}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onCopyRemoteUri(remote.uri)}
                >
                  <Copy className="h-3 w-3" />
                  <span className="hidden lg:inline">{copiedRemoteUri === remote.uri ? 'Copied' : 'Copy URI'}</span>
                </Button>
                {remote.url ? (
                  <a
                    href={remote.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="hidden lg:inline">Open</span>
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 md:px-4 py-3 md:py-4 align-top text-xs md:text-sm text-muted-foreground font-mono hidden sm:table-cell">
        <span className="truncate max-w-[80px] md:max-w-none block">{artifact.runId}</span>
      </td>
      <td className="px-3 md:px-4 py-3 md:py-4 align-top text-xs md:text-sm text-muted-foreground hidden md:table-cell">
        <span className="truncate max-w-[100px] block">{artifact.componentRef}</span>
      </td>
      <td className="px-3 md:px-4 py-3 md:py-4 align-top text-xs md:text-sm">{formatBytes(artifact.size)}</td>
      <td className="px-3 md:px-4 py-3 md:py-4 align-top text-xs md:text-sm text-muted-foreground hidden lg:table-cell">
        {formatTimestamp(artifact.createdAt)}
      </td>
      <td className="px-3 md:px-4 py-3 md:py-4 align-top text-right">
        <div className="flex flex-wrap justify-end gap-1 md:gap-2">
          <Button type="button" variant="ghost" size="sm" className="gap-1 md:gap-2 h-8 px-2 md:px-3" onClick={onCopy}>
            <Copy className="h-4 w-4" />
            <span className="hidden md:inline">{copied ? 'Copied' : 'Copy ID'}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 md:gap-2 h-8 px-2 md:px-3"
            onClick={onDownload}
            disabled={isDownloading}
          >
            <Download className="h-4 w-4" />
            <span className="hidden md:inline">{isDownloading ? 'Downloading…' : 'Download'}</span>
          </Button>
        </div>
      </td>
    </tr>
  )
}
