import { Badge } from '@/components/ui/badge';

export function SeverityBadge({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  const variant =
    s === 'critical'
      ? 'destructive'
      : s === 'high'
        ? 'warning'
        : s === 'medium'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{severity}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const variant = status === 'FAILED' ? 'destructive' : status === 'PASS' ? 'success' : 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}

export function formatTimestamp(ts: string) {
  if (!ts) return '--';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date(ts));
}
