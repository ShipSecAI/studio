import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, Search, Copy } from 'lucide-react'
import { useArtifactStore } from '@/store/artifactStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ArtifactMetadata } from '@shipsec/shared'

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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b bg-background px-6 py-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold">Artifact Library</h1>
            <p className="text-sm text-muted-foreground">
              Browse artifacts saved across workflow runs and reuse them in new automations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search artifacts..."
                  className="pl-8"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" variant="secondary" disabled={libraryLoading}>
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
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
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
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 bg-background shadow-sm">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Run</th>
                <th className="px-4 py-3 font-medium">Component</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium sr-only">Actions</th>
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
                  isDownloading={Boolean(downloading[artifact.id])}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ArtifactLibraryRow({
  artifact,
  onDownload,
  onCopy,
  copied,
  isDownloading,
}: {
  artifact: ArtifactMetadata
  onDownload: () => void
  onCopy: () => void
  copied: boolean
  isDownloading: boolean
}) {
  return (
    <tr className="border-b last:border-none">
      <td className="px-6 py-4 align-top">
        <div className="font-medium">{artifact.name}</div>
        <div className="text-xs text-muted-foreground font-mono">{artifact.id}</div>
      </td>
      <td className="px-4 py-4 align-top text-sm text-muted-foreground font-mono">
        {artifact.runId}
      </td>
      <td className="px-4 py-4 align-top text-sm text-muted-foreground">
        {artifact.componentRef}
      </td>
      <td className="px-4 py-4 align-top text-sm">{formatBytes(artifact.size)}</td>
      <td className="px-4 py-4 align-top text-sm text-muted-foreground">
        {formatTimestamp(artifact.createdAt)}
      </td>
      <td className="px-4 py-4 align-top text-right">
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={onCopy}>
            <Copy className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy ID'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={onDownload}
            disabled={isDownloading}
          >
            <Download className="h-4 w-4" />
            {isDownloading ? 'Downloading…' : 'Download'}
          </Button>
        </div>
      </td>
    </tr>
  )
}
