import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api';

interface AuditLogEntry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

function safeJsonPreview(value: Record<string, unknown> | null) {
  if (!value) return '';
  try {
    const keys = Object.keys(value);
    if (keys.length === 0) return '';
    return JSON.stringify(value).slice(0, 160);
  } catch {
    return '';
  }
}

export function AuditLogSettings() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      action: action.trim() || undefined,
      resourceType: resourceType.trim() || undefined,
      from: from.trim() || undefined,
      to: to.trim() || undefined,
      limit: 50,
      cursor: cursor ?? undefined,
    }),
    [action, resourceType, from, to, cursor],
  );

  const load = async (mode: 'reset' | 'next') => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auditLogs.list(query);
      setNextCursor(res.nextCursor ?? null);
      setItems((prev) => (mode === 'reset' ? res.items : [...prev, ...res.items]));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursor(null);
    load('reset').catch(() => {});
  }, [action, resourceType, from, to]);

  return (
    <div className="space-y-4">
      <div className="border rounded-md bg-card p-4">
        <h2 className="text-base font-semibold">Audit Log</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Search and review organization activity (who did what, when).
        </p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label htmlFor="audit-action">Action</Label>
            <Input
              id="audit-action"
              placeholder="e.g. secret.rotate"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-resource-type">Resource Type</Label>
            <Input
              id="audit-resource-type"
              placeholder="e.g. workflow"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-from">From (ISO)</Label>
            <Input
              id="audit-from"
              placeholder="2026-02-01T00:00:00Z"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to">To (ISO)</Label>
            <Input
              id="audit-to"
              placeholder="2026-02-10T00:00:00Z"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setAction('');
              setResourceType('');
              setFrom('');
              setTo('');
            }}
            disabled={loading}
          >
            Clear
          </Button>
          <Button
            onClick={() => {
              setCursor(null);
              load('reset').catch(() => {});
            }}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[190px]">Time</TableHead>
              <TableHead className="w-[120px]">Actor</TableHead>
              <TableHead className="w-[200px]">Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  No audit events found.
                </TableCell>
              </TableRow>
            )}
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-xs font-mono">
                  {formatTimestamp(row.createdAt)}
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="secondary">{row.actorType}</Badge>
                </TableCell>
                <TableCell className="text-xs font-mono">{row.action}</TableCell>
                <TableCell className="text-xs">
                  <div className="flex flex-col">
                    <span className="font-medium">{row.resourceType}</span>
                    <span className="text-muted-foreground font-mono">
                      {row.resourceName ?? row.resourceId ?? ''}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  {safeJsonPreview(row.metadata)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="p-3 border-t flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{items.length} event(s)</div>
          <Button
            variant="outline"
            disabled={loading || !nextCursor}
            onClick={() => {
              if (!nextCursor) return;
              setCursor(nextCursor);
              load('next').catch(() => {});
            }}
          >
            {nextCursor ? 'Load more' : 'No more'}
          </Button>
        </div>
      </div>
    </div>
  );
}
