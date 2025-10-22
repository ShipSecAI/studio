import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive'

export interface ToastOptions {
  id?: string
  title: string
  description?: string
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

const variantStyles: Record<ToastVariant, string> = {
  default: 'border border-border bg-card text-foreground shadow-md',
  success: 'border border-emerald-200 bg-emerald-50 text-emerald-900 shadow-emerald-200/50',
  warning: 'border border-amber-200 bg-amber-50 text-amber-900 shadow-amber-200/50',
  destructive: 'border border-destructive/60 bg-destructive/10 text-destructive shadow-destructive/40',
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
              'pointer-events-auto flex w-full max-w-sm items-start justify-between gap-4 rounded-md px-4 py-3 shadow-lg transition-transform sm:max-w-md',
              variantStyles[variant] ?? variantStyles.default,
            )}
          >
            <div className="flex-1">
              <p className="text-sm font-semibold">{title}</p>
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeToast(id)}
              className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
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
