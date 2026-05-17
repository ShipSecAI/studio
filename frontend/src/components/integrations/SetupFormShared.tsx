import { CheckCircle, XCircle } from 'lucide-react';

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
