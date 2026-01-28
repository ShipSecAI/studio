import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Copy, ExternalLink } from 'lucide-react';
import type { ArtifactMetadata } from '@shipsec/shared';
import { useArtifactStore } from '@/store/artifactStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getRemoteUploads } from '@/utils/artifacts';

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
};

const formatTimestamp = (value: string) => {
  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return value;
  }
};

interface RunArtifactsPanelProps {
  runId: string | null;
}

export function RunArtifactsPanel({ runId }: RunArtifactsPanelProps) {
  const entry = useArtifactStore((state) => (runId ? state.runArtifacts[runId] : undefined));
  const fetchRunArtifacts = useArtifactStore((state) => state.fetchRunArtifacts);
  const downloadArtifact = useArtifactStore((state) => state.downloadArtifact);
  const downloading = useArtifactStore((state) => state.downloading);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedRemoteUri, setCopiedRemoteUri] = useState<string | null>(null);

  const handleCopy = useCallback(async (artifactId: string) => {
    try {
      await navigator.clipboard.writeText(artifactId);
      setCopiedId(artifactId);
      setTimeout(() => {
        setCopiedId((current) => (current === artifactId ? null : current));
      }, 2000);
    } catch (error) {
      console.error('Failed to copy artifact ID', error);
    }
  }, []);

  useEffect(() => {
    if (runId) {
      void fetchRunArtifacts(runId);
    }
  }, [runId, fetchRunArtifacts]);

  const content = useMemo(() => {
    if (!runId) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a run to view its artifacts.
        </div>
      );
    }

    if (!entry || entry.loading) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading artifacts…
        </div>
      );
    }

    if (entry.error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-destructive">
          <span>{entry.error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchRunArtifacts(runId, true)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      );
    }

    if (entry.artifacts.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No artifacts were saved for this run.
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Component</th>
              <th className="px-4 py-2 font-medium">Size</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entry.artifacts.map((artifact) => (
              <ArtifactRow
                key={artifact.id}
                artifact={artifact}
                onDownload={() => downloadArtifact(artifact, { runId })}
                onCopy={() => handleCopy(artifact.id)}
                copied={copiedId === artifact.id}
                onCopyRemoteUri={async (uri: string) => {
                  try {
                    await navigator.clipboard.writeText(uri);
                    setCopiedRemoteUri(uri);
                    setTimeout(() => {
                      setCopiedRemoteUri((current) => (current === uri ? null : current));
                    }, 2000);
                  } catch (error) {
                    console.error('Failed to copy remote URI', error);
                  }
                }}
                copiedRemoteUri={copiedRemoteUri}
                isDownloading={Boolean(downloading[artifact.id])}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [
    runId,
    entry,
    fetchRunArtifacts,
    downloadArtifact,
    downloading,
    handleCopy,
    copiedId,
    copiedRemoteUri,
  ]);

  const handleDownloadAll = () => {
    if (!entry || !entry.artifacts.length) return;
    entry.artifacts.forEach((artifact) => {
      downloadArtifact(artifact, { runId: runId || undefined });
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-background/70 px-4 py-2">
        <div>
          <p className="text-sm font-semibold">Run artifacts</p>
          <p className="text-xs text-muted-foreground">
            Files saved by components during this workflow run.
          </p>
        </div>
        {runId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fetchRunArtifacts(runId, true)}
            disabled={entry?.loading}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        ) : null}
        {entry?.artifacts && entry.artifacts.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadAll}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Download All
          </Button>
        )}
      </div>
      {content}
    </div>
  );
}

function ArtifactRow({
  artifact,
  onDownload,
  onCopyRemoteUri,
  copiedRemoteUri,
  isDownloading,
}: {
  artifact: ArtifactMetadata;
  onDownload: () => void;
  onCopy: () => void;
  copied: boolean;
  onCopyRemoteUri: (uri: string) => void;
  copiedRemoteUri: string | null;
  isDownloading: boolean;
}) {
  const remoteUploads = getRemoteUploads(artifact);

  return (
    <tr className="border-b last:border-none">
      <td className="px-4 py-3 align-top">
        <div className="font-medium">{artifact.name}</div>
        <div className="text-xs text-muted-foreground font-mono">{artifact.id}</div>
        {remoteUploads.length > 0 && (
          <div className="mt-2 space-y-1">
            {remoteUploads.map((remote) => (
              <div
                key={`${artifact.id}-${remote.uri}`}
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <Badge variant="outline" className="text-[10px] uppercase">
                  {remote.type}
                </Badge>
                <code className="max-w-[200px] truncate font-mono text-[11px]">{remote.uri}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onCopyRemoteUri(remote.uri)}
                >
                  <Copy className="h-3 w-3" />
                  {copiedRemoteUri === remote.uri ? 'Copied' : 'Copy URI'}
                </Button>
                {remote.url ? (
                  <a
                    href={remote.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top text-sm text-muted-foreground">{artifact.componentRef}</td>
      <td className="px-4 py-3 align-top text-sm">{formatBytes(artifact.size)}</td>
      <td className="px-4 py-3 align-top text-sm text-muted-foreground">
        {formatTimestamp(artifact.createdAt)}
      </td>
      <td className="px-4 py-3 align-top text-right overflow-x-auto">
        <div className="flex flex-wrap justify-end gap-2">
          {/* <Button type="button" variant="ghost" size="sm" onClick={onCopy} className="gap-2">
            <Copy className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy ID'}
          </Button> */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDownload}
            disabled={isDownloading}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {isDownloading ? 'Downloading…' : 'Download'}
          </Button>
        </div>
      </td>
    </tr>
  );
}
