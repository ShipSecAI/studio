import { useContext } from 'react'
import { ToastContext, type ToastContextValue } from './toast-provider'

const noopToast: ToastContextValue = {
  toast: ({ title, description }) => {
    console.warn('[toast]', title, description)
    return { id: 'noop' }
  },
  dismiss: () => {},
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    return noopToast
  }
  return context
}

