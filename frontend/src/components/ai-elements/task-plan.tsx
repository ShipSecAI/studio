'use client';

import type { ComponentProps } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  Loader2Icon,
  ListTodoIcon,
  XCircleIcon,
  SkipForwardIcon,
} from 'lucide-react';

export interface TaskItem {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

export interface TaskPlanPart {
  type: 'task-plan';
  planId: string;
  title: string;
  tasks: TaskItem[];
}

const statusIcon: Record<TaskItem['status'], React.ReactNode> = {
  pending: <CircleIcon className="h-4 w-4 text-muted-foreground" />,
  in_progress: <Loader2Icon className="h-4 w-4 text-blue-500 animate-spin" />,
  done: <CheckCircleIcon className="h-4 w-4 text-green-500" />,
  failed: <XCircleIcon className="h-4 w-4 text-red-500" />,
  skipped: <SkipForwardIcon className="h-4 w-4 text-muted-foreground/60" />,
};

export type TaskPlanProps = ComponentProps<typeof Collapsible> & {
  plan: TaskPlanPart;
};

export function TaskPlan({ plan, className, ...props }: TaskPlanProps) {
  const { title, tasks } = plan;
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const hasActive = tasks.some((t) => t.status === 'in_progress');
  const allDone = done === total && total > 0;

  return (
    <Collapsible
      defaultOpen={!allDone}
      className={cn('group not-prose mb-4 w-full rounded-md border', className)}
      {...props}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors [&[data-state=open]>svg.chevron]:rotate-180">
        <ListTodoIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="flex-1 text-left truncate">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {done}/{total}
        </span>
        {hasActive && <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />}
        <ChevronDownIcon className="chevron h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0" />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="border-t px-3 py-2 space-y-1.5">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0">{statusIcon[task.status]}</span>
              <span
                className={cn(
                  'flex-1',
                  task.status === 'done' && 'text-muted-foreground line-through',
                  task.status === 'skipped' && 'text-muted-foreground/60 line-through',
                  task.status === 'failed' && 'text-red-600 dark:text-red-400',
                )}
              >
                {task.label}
                {task.detail && (
                  <span className="ml-1 text-xs text-muted-foreground">({task.detail})</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
