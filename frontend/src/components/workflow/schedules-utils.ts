import type { WorkflowSchedule } from '@shipsec/shared';

export const formatScheduleTimestamp = (value?: string | null) => {
  if (!value) return 'Not scheduled';
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return value;
  }
};

export const scheduleStatusVariant: Record<
  WorkflowSchedule['status'],
  'default' | 'secondary' | 'destructive'
> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
};
