import { Badge } from '@/components/ui/badge';
import { STATUS_VARIANTS } from './scheduled-surface-utils';

export function ScheduledStatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANTS[status] || 'outline';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge variant={variant}>{label}</Badge>;
}
