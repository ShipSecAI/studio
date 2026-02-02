import { createContext, type ReactNode } from 'react';

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive';

export interface ToastOptions {
  id?: string;
  title: string;
  description?: ReactNode;
  duration?: number;
  variant?: ToastVariant;
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => { id: string };
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
