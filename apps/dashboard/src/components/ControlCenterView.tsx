import { useCallback, useEffect, useState } from 'react'
import { apiUrl, authFetch } from '../apiBase'

type Summary = {
  postgres: { ok: boolean; error?: string }
  redis: { ok: boolean; error?: string }
  whatsapp: { status: string; updatedAt: number | null; baileysSendEnabled: boolean }
  env: {
    nodeEnv: string
    businessHoursDeferralOff: boolean
    defaultTenantConfigured: boolean
  }
  whatsappQueue: {
    counts: Record<string, number>
    failedSample: Array<{
      id: string
      finishedOn: string | null
      attemptsMade: number
      failedReason: string
      tenantId?: string
      leadId?: string
      phoneDigits?: string
      bodyPreview: string
    }>
  }
  discovery: {
    totalSlices: number
    coolingSlices: number
    staleSlices: number
    top: Array<{
      sliceKey: string
      staleRuns: number
      cooldownLeftMs: number
      lastRunAtMs: number | null
      lastNewLeads: number | null
    }>
  }
  hints: { delayedMeans: string; failedMeans: string; discoveryMeans?: string }
}

function chip(ok: boolean) {
  return ok
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
    : 'bg-rose-500/15 text-rose-300 border-rose-500/25'
}

export function ControlCenterView() {
  const [data, setData] = useState<Summary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await authFetch(apiUrl('/api/admin/summary'))
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t.slice(0, 400) || res.statusText)
      }
      setData((await res.json()) as Summary)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const removeAllFailed = async () => {
    if (!confirm('Удалить все failed jobs из очереди whatsapp_outreach? Это не отправит сообщения заново.')) return
    setRemoving(true)
    setErr(null)
    try {
      const res = await authFetch(apiUrl('/api/admin/queues/whatsapp/failed/remove'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t.slice(0, 400))
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRemoving(false)
    }
  }

  const removeAllDelayed = async (resetRateKeys: boolean) => {
    const msg = resetRateKeys
      ? 'Удалить все delayed jobs и сбросить Redis-лимиты отправки (wa:rate:*)? Отложенные отправки из очереди будут отменены; новые задачи не унаследуют старые счётчики.'
      : 'Удалить все delayed jobs? Запланированные на потом отправки из очереди будут отменены (не повторятся сами).'
    if (!confirm(msg)) return
    setRemoving(true)
    setErr(null)
    try {
      const res = await authFetch(apiUrl('/api/admin/queues/whatsapp/delayed/remove'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, resetOutboundRateKeys: resetRateKeys }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t.slice(0, 400))
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRemoving(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 text-sm">Загрузка панели…</div>
    )
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-white/10 bg-slate-900/80 px-4 py-2 text-xs font-medium text-slate-200 hover:border-sky-500/40 hover:bg-slate-800/80"
        >
          Обновить
        </button>
        {data && (
          <>
            <button
              type="button"
              disabled={removing || (data.whatsappQueue.counts.delayed ?? 0) === 0}
              onClick={() => void removeAllDelayed(false)}
              className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-xs font-medium text-amber-100 hover:bg-amber-950/50 disabled:opacity-40"
            >
              {removing ? 'Удаление…' : 'Очистить delayed jobs'}
            </button>
            <button
              type="button"
              disabled={removing || (data.whatsappQueue.counts.delayed ?? 0) === 0}
              onClick={() => void removeAllDelayed(true)}
              className="rounded-xl border border-amber-500/20 bg-slate-900/80 px-4 py-2 text-xs font-medium text-amber-200/90 hover:bg-slate-800/80 disabled:opacity-40"
              title="Также удалить ключи wa:rate:* (счётчики лимитов час/день)"
            >
              Delayed + сброс лимитов
            </button>
            <button
              type="button"
              disabled={removing || (data.whatsappQueue.counts.failed ?? 0) === 0}
              onClick={() => void removeAllFailed()}
              className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-2 text-xs font-medium text-rose-200 hover:bg-rose-950/50 disabled:opacity-40"
            >
              {removing ? 'Удаление…' : 'Очистить failed jobs'}
            </button>
          </>
        )}
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">{err}</div>
      )}

      {data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="crm-panel rounded-2xl border border-white/[0.08] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Postgres</p>
              <p className={`mt-2 inline-flex rounded-lg border px-2 py-1 text-xs ${chip(data.postgres.ok)}`}>
                {data.postgres.ok ? 'OK' : 'FAIL'}
              </p>
              {data.postgres.error && <p className="mt-2 text-xs text-rose-300/90">{data.postgres.error}</p>}
            </div>
            <div className="crm-panel rounded-2xl border border-white/[0.08] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Redis</p>
              <p className={`mt-2 inline-flex rounded-lg border px-2 py-1 text-xs ${chip(data.redis.ok)}`}>
                {data.redis.ok ? 'OK' : 'FAIL'}
              </p>
              {data.redis.error && <p className="mt-2 text-xs text-rose-300/90">{data.redis.error}</p>}
            </div>
            <div className="crm-panel rounded-2xl border border-white/[0.08] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">WhatsApp (Baileys)</p>
              <p className="mt-2 text-sm text-slate-200">
                Статус: <span className="text-emerald-300">{data.whatsapp.status}</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Отправка: {data.whatsapp.baileysSendEnabled ? 'включена' : 'выключена'}
              </p>
            </div>
          </section>

          <section className="crm-panel rounded-2xl border border-white/[0.08] p-5 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Окружение</p>
            <ul className="text-sm text-slate-300 space-y-1 font-mono text-xs">
              <li>
                NODE_ENV=<span className="text-sky-300">{data.env.nodeEnv}</span>
              </li>
              <li>
                Окно Almaty 9–19:{' '}
                <span className={data.env.businessHoursDeferralOff ? 'text-emerald-300' : 'text-amber-300'}>
                  {data.env.businessHoursDeferralOff ? 'не блокирует отправку' : 'блокирует вне окна'}
                </span>
              </li>
              <li>
                DEFAULT_TENANT_ID:{' '}
                {data.env.defaultTenantConfigured ? (
                  <span className="text-emerald-300">задан</span>
                ) : (
                  <span className="text-rose-300">не задан</span>
                )}
              </li>
            </ul>
          </section>

          <section className="crm-panel rounded-2xl border border-white/[0.08] p-5 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Очередь BullMQ · whatsapp_outreach
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(data.whatsappQueue.counts).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-slate-300"
                >
                  {k}: <span className="text-slate-100 font-medium">{v}</span>
                </span>
              ))}
            </div>
            {(data.whatsappQueue.counts.delayed ?? 0) > 0 && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-100/95 leading-relaxed">
                <span className="font-medium text-amber-200">Отложенные задачи (delayed)</span> — смотрите в логах воркера JSON с префиксом{' '}
                <code className="rounded bg-slate-900/80 px-1 text-[11px] text-sky-200/90">[wa-agent]</code>, поле{' '}
                <code className="text-[11px] text-amber-200/90">deferralReason</code>: обычно{' '}
                <code className="text-[11px]">business_hours</code>, <code className="text-[11px]">hour_cap</code> или{' '}
                <code className="text-[11px]">day_cap</code>. Полное описание:{' '}
                <code className="text-[11px] text-slate-500">docs/WHATSAPP_AGENT_TECH.md</code>.
              </div>
            )}
            <p className="text-xs text-slate-500 leading-relaxed">{data.hints.delayedMeans}</p>
            <p className="text-xs text-slate-500 leading-relaxed">{data.hints.failedMeans}</p>
            <p className="text-xs text-slate-500 leading-relaxed border-t border-white/[0.06] pt-3 mt-1">
              Агент (классификация → очередь → отправка): в логах воркера ищите{' '}
              <code className="rounded bg-slate-900/80 px-1 text-[11px] text-sky-200/90">[wa-agent]</code> — одна
              JSON-строка на событие. Док:{' '}
              <code className="text-[11px] text-slate-500">docs/WHATSAPP_AGENT_TECH.md</code>.
            </p>
          </section>

          <section className="crm-panel rounded-2xl border border-white/[0.08] p-5 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Discovery Intelligence
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-slate-300">
                slices: <span className="text-slate-100 font-medium">{data.discovery.totalSlices}</span>
              </span>
              <span className="rounded-lg border border-amber-500/20 bg-amber-950/20 px-2 py-1 text-amber-200">
                cooling: <span className="font-medium">{data.discovery.coolingSlices}</span>
              </span>
              <span className="rounded-lg border border-rose-500/20 bg-rose-950/20 px-2 py-1 text-rose-200">
                stale: <span className="font-medium">{data.discovery.staleSlices}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              {data.hints.discoveryMeans ?? 'Adaptive crawler: stale slices are backoff-throttled and crawled shallower.'}
            </p>

            <div className="overflow-x-auto">
              {data.discovery.top.length === 0 ? (
                <p className="text-sm text-slate-500">Пока нет данных по discovery slices.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-500">
                      <th className="px-3 py-2 font-medium">slice</th>
                      <th className="px-3 py-2 font-medium">stale</th>
                      <th className="px-3 py-2 font-medium">cooldown left</th>
                      <th className="px-3 py-2 font-medium">last new</th>
                      <th className="px-3 py-2 font-medium">last run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.discovery.top.map((r) => (
                      <tr key={r.sliceKey} className="border-b border-white/[0.04] text-slate-300 hover:bg-slate-900/30">
                        <td className="px-3 py-2 font-mono text-[11px] text-sky-300/90">{r.sliceKey}</td>
                        <td className="px-3 py-2">{r.staleRuns}</td>
                        <td className="px-3 py-2">
                          {r.cooldownLeftMs > 0 ? `${Math.ceil(r.cooldownLeftMs / 60000)}m` : 'ready'}
                        </td>
                        <td className="px-3 py-2">{r.lastNewLeads ?? '—'}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {r.lastRunAtMs ? new Date(r.lastRunAtMs).toLocaleString('ru-RU') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="crm-panel rounded-2xl border border-white/[0.08] overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-3 bg-slate-900/40">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Журнал ошибок (failed jobs, последние {data.whatsappQueue.failedSample.length})
              </p>
            </div>
            <div className="overflow-x-auto">
              {data.whatsappQueue.failedSample.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">Нет failed jobs.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-500">
                      <th className="px-4 py-2 font-medium">id</th>
                      <th className="px-4 py-2 font-medium">время</th>
                      <th className="px-4 py-2 font-medium">причина</th>
                      <th className="px-4 py-2 font-medium">tenant / lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.whatsappQueue.failedSample.map((r) => (
                      <tr key={r.id} className="border-b border-white/[0.04] text-slate-300 hover:bg-slate-900/30">
                        <td className="px-4 py-2 font-mono text-[11px] text-sky-300/90">{r.id}</td>
                        <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                          {r.finishedOn ? new Date(r.finishedOn).toLocaleString('ru-RU') : '—'}
                        </td>
                        <td className="px-4 py-2 max-w-md">
                          <span className="text-rose-200/90 line-clamp-3">{r.failedReason}</span>
                          {r.bodyPreview && (
                            <p className="mt-1 text-[10px] text-slate-600 line-clamp-2">{r.bodyPreview}</p>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-[10px] text-slate-500">
                          {r.tenantId?.slice(0, 8) ?? '—'} / {r.leadId?.slice(0, 8) ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <p className="text-xs text-slate-600">
            Полные логи воркеров по-прежнему в терминале процесса <code className="text-slate-500">npm run dev:workers</code>.
            Здесь — состояние инфраструктуры и причины падений задач в очереди.
          </p>
        </>
      )}
    </div>
  )
}
