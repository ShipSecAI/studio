import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WorkflowNameOption } from './scheduled-surface-utils';

interface StatusOption {
  value: string;
  label: string;
}

export function StatusWorkflowFilters({
  status,
  workflowId,
  statusOptions,
  workflows,
  workflowsLoading,
  onStatusChange,
  onWorkflowChange,
}: {
  status: string;
  workflowId: string | null;
  statusOptions: StatusOption[];
  workflows: WorkflowNameOption[];
  workflowsLoading: boolean;
  onStatusChange: (value: string) => void;
  onWorkflowChange: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <label className="text-xs uppercase text-muted-foreground">Status</label>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger>
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs uppercase text-muted-foreground">Workflow</label>
        <Select
          value={workflowId ?? 'all'}
          onValueChange={onWorkflowChange}
          disabled={workflowsLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder="All workflows" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workflows</SelectItem>
            {workflows.map((workflow) => (
              <SelectItem key={workflow.id} value={workflow.id}>
                {workflow.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
