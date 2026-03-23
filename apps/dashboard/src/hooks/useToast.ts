import { createContext, useContext } from 'react'

type ToastType = 'success' | 'error' | 'info'

export interface ToastContext {
  toast: (message: string, type?: ToastType) => void
}

export const ToastCtx = createContext<ToastContext>({ toast: () => {} })

export const useToast = () => useContext(ToastCtx)
