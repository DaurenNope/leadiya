import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type ExtensionConnection = 'connected' | 'disconnected' | 'checking'

const ExtensionStatusContext = createContext<ExtensionConnection>('checking')

export function ExtensionStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ExtensionConnection>('checking')

  useEffect(() => {
    let disposed = false
    const PING = 'LEADIYA_EXTENSION_PING'
    const PONG = 'LEADIYA_EXTENSION_PONG'

    const check = () => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onMessage)
        if (!disposed) setStatus('disconnected')
      }, 1200)

      const onMessage = (event: MessageEvent) => {
        if (event.source !== window) return
        const data = event.data as { type?: string; requestId?: string } | null
        if (!data || data.type !== PONG || data.requestId !== requestId) return
        window.clearTimeout(timeout)
        window.removeEventListener('message', onMessage)
        if (!disposed) setStatus('connected')
      }

      window.addEventListener('message', onMessage)
      window.postMessage({ type: PING, requestId }, '*')
    }

    check()
    const id = window.setInterval(check, 10_000)
    return () => {
      disposed = true
      window.clearInterval(id)
    }
  }, [])

  return <ExtensionStatusContext.Provider value={status}>{children}</ExtensionStatusContext.Provider>
}

export function useExtensionStatus() {
  return useContext(ExtensionStatusContext)
}
