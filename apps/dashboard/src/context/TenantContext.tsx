import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { apiUrl, authFetch } from '../apiBase'

interface Tenant {
  id: string
  name: string
  slug: string
  active: boolean
  trialEndsAt: string | null
}

interface TenantState {
  tenant: Tenant | null
  loading: boolean
  error: string | null
}

const TenantContext = createContext<TenantState | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when session ends
      setTenant(null)
      return
    }

    let cancelled = false

    const resolve = async () => {
      setLoading(true)
      setError(null)

      try {
        const res = await authFetch(apiUrl('/api/tenants/me'))

        if (res.ok) {
          const data = await res.json() as { tenant: Tenant }
          if (!cancelled) setTenant(data.tenant)
        } else if (res.status === 404) {
          const createRes = await authFetch(apiUrl('/api/tenants/me'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          if (createRes.ok) {
            const data = await createRes.json() as { tenant: Tenant }
            if (!cancelled) setTenant(data.tenant)
          } else {
            if (!cancelled) setError('Не удалось создать рабочее пространство')
          }
        } else {
          if (!cancelled) setError('Ошибка загрузки данных')
        }
      } catch {
        if (!cancelled) setError('Сервер недоступен')
      }

      if (!cancelled) setLoading(false)
    }

    void resolve()
    return () => { cancelled = true }
  }, [user])

  return (
    <TenantContext.Provider value={{ tenant, loading, error }}>
      {children}
    </TenantContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook paired with TenantProvider
export function useTenant(): TenantState {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within TenantProvider')
  return ctx
}
