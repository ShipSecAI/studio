import type { ReactNode } from 'react';
import { CheckCircle, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface SetupResult {
  ok: boolean;
  message: string;
}

export function SetupResultAlert({ result }: { result: SetupResult | null }) {
  if (!result) return null;

  const Icon = result.ok ? CheckCircle : XCircle;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm',
        result.ok
          ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
          : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
      )}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{result.message}</span>
    </div>
  );
}

export function SetupLoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

export function SetupErrorState({
  message,
  errorFallback,
  note,
}: {
  message: unknown;
  errorFallback: string;
  note: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border p-3 text-sm border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{message instanceof Error ? message.message : errorFallback}</span>
      </div>
      <div className="text-sm text-muted-foreground">{note}</div>
    </div>
  );
}

export function SetupStepIndicator({
  step,
  steps,
  onStepChange,
}: {
  step: number;
  steps: string[];
  onStepChange: (step: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {steps.map((label, index) => {
        const stepNumber = index + 1;
        return (
          <div key={label} className="contents">
            {index > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            <button
              type="button"
              onClick={() => onStepChange(stepNumber)}
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                step === stepNumber
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold border-current">
                {stepNumber}
              </span>
              {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function SetupWhyDisclosure({
  open,
  title,
  children,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="rounded-md border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 p-3 text-left text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md transition-colors"
      >
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-blue-700/80 dark:text-blue-300/80 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function SetupPermissionCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3 bg-muted/30">
      <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function SetupTip({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
      <p className="text-xs text-amber-700 dark:text-amber-300">{children}</p>
    </div>
  );
}

export { ChevronRight };
