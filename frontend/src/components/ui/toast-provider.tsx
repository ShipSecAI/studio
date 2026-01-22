import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import {
  ToastContext,
  type ToastContextValue,
  type ToastOptions,
  type ToastVariant,
} from './toast-context';

interface ToastEntry extends ToastOptions {
  id: string;
}

const DEFAULT_DURATION = 10000;
const ERROR_DURATION = 20000;
const MAX_VISIBLE_STACK = 5; // How many toasts show in the stack visually

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

// Variant styles with accent colors
const variantStyles: Record<ToastVariant, { border: string; accent: string }> = {
  default: {
    border: 'border-border',
    accent: 'bg-primary',
  },
  success: {
    border: 'border-emerald-500/40',
    accent: 'bg-emerald-500',
  },
  warning: {
    border: 'border-amber-500/40',
    accent: 'bg-amber-500',
  },
  destructive: {
    border: 'border-red-500/40',
    accent: 'bg-red-500',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const handle = timeoutsRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const clearAllToasts = useCallback(() => {
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    timeoutsRef.current.clear();
    setToasts([]);
    setIsExpanded(false);
  }, []);

  const addToast = useCallback(
    (options: ToastOptions) => {
      const id = options.id ?? generateId();
      const variant = options.variant ?? 'default';
      const defaultDuration = variant === 'destructive' ? ERROR_DURATION : DEFAULT_DURATION;

      const entry: ToastEntry = {
        ...options,
        id,
        variant,
        duration: options.duration ?? defaultDuration,
      };

      setToasts((current) => [...current, entry]);

      if (entry.duration && entry.duration > 0 && entry.duration !== Infinity) {
        const timeout = window.setTimeout(() => {
          removeToast(id);
        }, entry.duration);
        timeoutsRef.current.set(id, timeout);
      }

      return { id };
    },
    [removeToast],
  );

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      timeoutsRef.current.clear();
    };
  }, []);

  // Auto-collapse when only 1 toast left
  useEffect(() => {
    if (toasts.length <= 1) {
      setIsExpanded(false);
    }
  }, [toasts.length]);

  const contextValue = useMemo<ToastContextValue>(
    () => ({
      toast: addToast,
      dismiss: removeToast,
    }),
    [addToast, removeToast],
  );

  // Get the toasts to display (newest first for stacking)
  const reversedToasts = [...toasts].reverse();
  const frontToast = reversedToasts[0];
  const stackedToasts = reversedToasts.slice(1, MAX_VISIBLE_STACK);
  const hiddenCount = Math.max(0, toasts.length - MAX_VISIBLE_STACK);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && (
        <div
          className="pointer-events-none fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[999]"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {/* Expanded View - All toasts stacked vertically */}
          {isExpanded ? (
            <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto pr-1">
              {reversedToasts.map(({ id, title, description, variant = 'default' }) => {
                const styles = variantStyles[variant];
                return (
                  <div
                    key={id}
                    className={cn(
                      'pointer-events-auto relative w-[340px] sm:w-[380px] rounded-lg border bg-card/95 backdrop-blur-md shadow-xl',
                      'animate-in fade-in-0 slide-in-from-right-2 duration-200',
                      styles.border,
                    )}
                  >
                    {/* Left accent */}
                    <div
                      className={cn(
                        'absolute left-0 top-0 bottom-0 w-1 rounded-l-lg',
                        styles.accent,
                      )}
                    />

                    <div className="flex items-start gap-3 p-3 pl-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{title}</p>
                        {description && (
                          <p className="mt-1 text-xs text-muted-foreground break-words line-clamp-3">
                            {typeof description === 'string' ? description : ''}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeToast(id)}
                        className="pointer-events-auto flex-shrink-0 p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Collapse button */}
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                className="pointer-events-auto self-end px-3 py-1.5 rounded-md bg-muted/90 backdrop-blur border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-all"
              >
                Collapse
              </button>
            </div>
          ) : (
            /* Stacked/Bundled View - Cards behind each other */
            <div
              className="relative"
              style={{
                // Reserve space for the stack depth
                paddingTop: stackedToasts.length * 8 + (hiddenCount > 0 ? 16 : 0),
              }}
            >
              {/* Hidden count indicator */}
              {hiddenCount > 0 && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-muted/80 backdrop-blur border border-border text-[10px] font-medium text-muted-foreground"
                  style={{ top: 0 }}
                >
                  +{hiddenCount} more
                </div>
              )}

              {/* Stacked background toasts (showing peek of cards behind) */}
              {stackedToasts.map((toast, index) => {
                const styles = variantStyles[toast.variant || 'default'];
                const depth = index + 1; // 1, 2 (further back)

                return (
                  <div
                    key={toast.id}
                    className={cn(
                      'absolute left-0 right-0 rounded-lg border bg-card/90 backdrop-blur-sm shadow-lg pointer-events-none',
                      'transition-all duration-300 ease-out',
                      styles.border,
                    )}
                    style={{
                      // Position behind the front card
                      top:
                        hiddenCount > 0
                          ? 16 + (stackedToasts.length - 1 - index) * 8
                          : (stackedToasts.length - 1 - index) * 8,
                      // Scale down slightly for depth effect
                      transform: `scale(${1 - depth * 0.03})`,
                      transformOrigin: 'top center',
                      // Fade out further back cards
                      opacity: 1 - depth * 0.15,
                      // Lower z-index for cards further back
                      zIndex: 10 - depth,
                    }}
                  >
                    {/* Left accent */}
                    <div
                      className={cn(
                        'absolute left-0 top-0 bottom-0 w-1 rounded-l-lg',
                        styles.accent,
                      )}
                    />

                    <div className="p-3 pl-4">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {toast.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">
                        {typeof toast.description === 'string' ? toast.description : ''}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Front toast (fully visible and interactive) */}
              {frontToast && (
                <div
                  className={cn(
                    'pointer-events-auto relative w-[340px] sm:w-[380px] rounded-lg border bg-card backdrop-blur-md shadow-2xl',
                    'animate-in fade-in-0 slide-in-from-right-3 duration-300',
                    'transition-all ease-out',
                    variantStyles[frontToast.variant || 'default'].border,
                  )}
                  style={{ zIndex: 20 }}
                >
                  {/* Left accent */}
                  <div
                    className={cn(
                      'absolute left-0 top-0 bottom-0 w-1 rounded-l-lg',
                      variantStyles[frontToast.variant || 'default'].accent,
                    )}
                  />

                  <div className="flex items-start gap-3 p-3 pl-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{frontToast.title}</p>
                      {frontToast.description && (
                        <p className="mt-1 text-xs text-muted-foreground break-words max-h-[80px] overflow-y-auto">
                          {typeof frontToast.description === 'string'
                            ? frontToast.description
                            : frontToast.description}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeToast(frontToast.id)}
                      className="flex-shrink-0 p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Footer actions when multiple toasts */}
                  {toasts.length > 1 && (
                    <div className="flex items-center justify-between px-3 pb-2 pt-0 border-t border-border/50 mt-1">
                      <button
                        type="button"
                        onClick={() => setIsExpanded(true)}
                        className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
                      >
                        View all ({toasts.length})
                      </button>
                      <button
                        type="button"
                        onClick={clearAllToasts}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}
