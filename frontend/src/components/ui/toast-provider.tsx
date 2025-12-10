import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive'

export interface ToastOptions {
  id?: string
  title: string
  description?: ReactNode
  duration?: number
  variant?: ToastVariant
}

interface ToastEntry extends ToastOptions {
  id: string
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => { id: string }
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION = 5000

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

// Keep variants minimal so the base class controls readability.
const variantStyles: Record<ToastVariant, string> = {
  default: '',
  success: 'ring-emerald-400/40 dark:ring-emerald-500/40',
  warning: 'ring-amber-400/40 dark:ring-amber-500/40',
  destructive: 'ring-red-500/40 dark:ring-red-400/40',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const timeoutsRef = useRef<Map<string, number>>(new Map())

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const handle = timeoutsRef.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timeoutsRef.current.delete(id)
    }
  }, [])

  const addToast = useCallback((options: ToastOptions) => {
    const id = options.id ?? generateId()
    const entry: ToastEntry = {
      ...options,
      id,
      variant: options.variant ?? 'default',
      duration: options.duration ?? DEFAULT_DURATION,
    }

    setToasts((current) => [...current, entry])

    if (entry.duration && entry.duration > 0 && entry.duration !== Infinity) {
      const timeout = window.setTimeout(() => {
        removeToast(id)
      }, entry.duration)
      timeoutsRef.current.set(id, timeout)
    }

    return { id }
  }, [removeToast])

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      timeoutsRef.current.clear()
    }
  }, [])

  const contextValue = useMemo<ToastContextValue>(() => ({
    toast: addToast,
    dismiss: removeToast,
  }), [addToast, removeToast])

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div
        className="pointer-events-none fixed inset-0 z-[999] flex flex-col items-end justify-end gap-2 p-4 sm:p-6"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {toasts.map(({ id, title, description, variant = 'default' }) => (
          <div
            key={id}
            className={cn(
              // High-contrast base + subtle ring by variant - supports light and dark mode
              'pointer-events-auto flex w-full max-w-sm items-start justify-between gap-4 rounded-md px-4 py-3 sm:max-w-md rounded-xl',
              'border border-border bg-card text-card-foreground shadow-lg shadow-black/10 dark:shadow-black/30 ring-1 ring-black/5 dark:ring-white/10 backdrop-blur-sm',
              variantStyles[variant] ?? '',
            )}
          >
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              {description && (
                <div className="mt-1 text-sm text-muted-foreground">
                  {typeof description === 'string' ? (
                    <p>{description}</p>
                  ) : (
                    description
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeToast(id)}
              className="text-xs font-semibold text-muted-foreground transition hover:text-foreground"
              aria-label="Dismiss notification"
            >
              Close
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
