import React from 'react';
import { AlertCircle, AlertTriangle, Search, Settings, ShieldAlert, WifiOff } from 'lucide-react';
import type { TraceError } from '@shipsec/shared';
import { cn } from '@/lib/utils';

interface ExecutionErrorViewProps {
  error: TraceError;
  className?: string;
}

/**
 * Renders structured execution errors from the worker with appropriate icons and formatting.
 * Handles specialized display for ValidationError, NotFoundError, etc.
 */
export const ExecutionErrorView: React.FC<ExecutionErrorViewProps> = ({ error, className }) => {
  const { type, message, details, fieldErrors } = error;

  // Pick icon and color based on error type
  const getErrorConfig = () => {
    switch (type) {
      case 'ValidationError':
        return {
          icon: ShieldAlert,
          label: 'Validation Error',
          color: 'text-orange-600 dark:text-orange-400',
          bg: 'bg-orange-50 dark:bg-orange-900/20',
          border: 'border-orange-200 dark:border-orange-800',
        };
      case 'NotFoundError':
        return {
          icon: Search,
          label: 'Not Found',
          color: 'text-red-600 dark:text-red-400',
          bg: 'bg-red-50 dark:bg-red-900/20',
          border: 'border-red-200 dark:border-red-800',
        };
      case 'ConfigurationError':
        return {
          icon: Settings,
          label: 'Configuration Error',
          color: 'text-amber-600 dark:text-amber-400',
          bg: 'bg-amber-50 dark:bg-amber-900/20',
          border: 'border-amber-200 dark:border-amber-800',
        };
      case 'NetworkError':
        return {
          icon: WifiOff,
          label: 'Network Error',
          color: 'text-rose-600 dark:text-rose-400',
          bg: 'bg-rose-50 dark:bg-rose-900/20',
          border: 'border-rose-200 dark:border-rose-800',
        };
      case 'TimeoutError':
        return {
          icon: AlertTriangle,
          label: 'Timeout',
          color: 'text-slate-600 dark:text-slate-400',
          bg: 'bg-slate-50 dark:bg-slate-900/20',
          border: 'border-slate-200 dark:border-slate-800',
        };
      default:
        return {
          icon: AlertCircle,
          label: type || 'Execution Error',
          color: 'text-red-600 dark:text-red-400',
          bg: 'bg-red-50 dark:bg-red-900/20',
          border: 'border-red-200 dark:border-red-800',
        };
    }
  };

  const config = getErrorConfig();
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'rounded-md border p-2 text-[11px] leading-tight flex flex-col gap-1.5 max-h-[300px] overflow-y-auto',
        config.bg,
        config.border,
        className,
      )}
      // Prevent wheel events from propagating to React Flow canvas (which would zoom instead of scroll)
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className={cn('flex items-center gap-1.5 font-bold uppercase tracking-wider', config.color)}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{config.label}</span>
      </div>

      <div className="text-foreground/90 break-words font-medium">{message}</div>

      {/* Render specialized details */}
      {type === 'ValidationError' && fieldErrors && (
        <div className="mt-1 space-y-1 pl-1">
          {Object.entries(fieldErrors).map(([field, errors]) => (
            <div key={field} className="flex flex-col gap-0.5">
              <span className="font-semibold text-foreground/70 uppercase text-[9px]">{field}</span>
              <ul className="list-none pl-1 space-y-0.5">
                {errors.map((err, i) => (
                  <li key={i} className="text-red-500 flex items-start gap-1">
                    <span className="mt-1 block h-1 w-1 rounded-full bg-red-400 flex-shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Render generic details if no specialized render */}
      {type !== 'ValidationError' && details && Object.keys(details).length > 0 && (
        <div className="mt-1 border-t border-black/5 dark:border-white/5 pt-1.5 flex flex-wrap gap-x-3 gap-y-1 opacity-70">
          {Object.entries(details).map(([key, value]) => {
            // Skip large objects or redundant info
            if (typeof value === 'object' || key === 'activityId' || key === 'nodeRef') return null;
            return (
              <div key={key} className="flex gap-1 items-baseline">
                <span className="font-semibold">{key}:</span>
                <span>{String(value)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
