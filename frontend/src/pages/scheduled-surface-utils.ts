export interface WorkflowNameOption {
  id: string;
  name: string;
}

export type StatusVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export const ACTIVE_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'error', label: 'Error' },
];

export const STATUS_VARIANTS: Record<string, StatusVariant> = {
  active: 'default',
  paused: 'secondary',
  inactive: 'secondary',
  error: 'destructive',
};

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
  }).format(date);
}

export function getWorkflowName(workflowId: string, workflows: WorkflowNameOption[]) {
  return workflows.find((workflow) => workflow.id === workflowId)?.name ?? 'Unknown workflow';
}
