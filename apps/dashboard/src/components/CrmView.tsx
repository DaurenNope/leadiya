import { useCallback, useEffect, useState } from 'react'
import type { Lead } from '../types'
import { apiUrl } from '../apiBase'
import { OutreachCrmForm } from './OutreachCrmForm'
import { WhatsAppConnectPanel } from './WhatsAppConnectPanel'
import { leadStatusLabel } from '../lib/lead-ui'
import { primaryEmail } from '../lib/lead-contact'
import { phoneDigitsForWa, waMeLink } from '../lib/wa-link'

type Props = {
  seedLeadId: string | null
  onSeedConsumed: () => void
  onBrowseLeads: () => void
  /** Открыть раздел «WhatsApp» — общая лента из журнала */
  onOpenWhatsApp?: () => void
}

function initials(name: string | null | undefined): string {
  const t = (name || '?').trim()
  if (!t) return '?'
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

function statusPillClass(status: string | null | undefined): string {
  const s = (status || 'new').toLowerCase()
  if (s === 'enriched' || s === 'valid') return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25'
  if (s === 'failed') return 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/25'
  if (s === 'archived') return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
  return 'bg-slate-500/15 text-slate-400 ring-1 ring-white/10'
}

function primaryPhone(lead: Lead | null): string | null {
  if (!lead) return null
  const w = lead.whatsapp?.trim()
  if (w) return w
  const c = lead.contacts?.find((x) => x.phone?.trim())?.phone?.trim()
  return c || null
}

export function CrmView({ seedLeadId, onSeedConsumed, onBrowseLeads, onOpenWhatsApp }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [pickerLeads, setPickerLeads] = useState<Lead[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Lead | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 320)
    return () => window.clearTimeout(t)
  }, [searchInput])

  const loadPicker = useCallback(async () => {
    setPickerLoading(true)
    setPickerError(null)
    try {
      const q = debouncedQ ? `&q=${encodeURIComponent(debouncedQ)}` : ''
      const res = await fetch(apiUrl(`/api/companies?limit=60&offset=0&sortBy=createdAt&sortOrder=desc${q}`))
      const data = (await res.json().catch(() => ({}))) as { items?: Lead[]; error?: string }
      if (!res.ok) {
        setPickerLeads([])
        setPickerError(data.error || `Ошибка загрузки (${res.status})`)
        return
      }
      setPickerLeads(Array.isArray(data.items) ? data.items : [])
    } catch (e) {
      setPickerLeads([])
      setPickerError(e instanceof Error ? e.message : 'Сеть недоступна')
    } finally {
      setPickerLoading(false)
    }
  }, [debouncedQ])

  useEffect(() => {
    void loadPicker()
  }, [loadPicker])

  const loadLeadDetail = useCallback(async (l: Lead) => {
    setSelected(l)
    setDetailLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/companies/${l.id}`))
      if (res.ok) {
        const full = (await res.json()) as Lead
        setSelected(full)
      }
    } catch {
      /* оставляем черновик из списка */
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!seedLeadId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(apiUrl(`/api/companies/${seedLeadId}`))
        if (!res.ok) return
        const lead = (await res.json()) as Lead
        if (!cancelled) {
          setSelected(lead)
          onSeedConsumed()
        }
      } catch {
        if (!cancelled) onSeedConsumed()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [seedLeadId, onSeedConsumed])

  const phone = primaryPhone(selected)
  const digitsOk = phone ? phoneDigitsForWa(phone) : null
  const waQuick = digitsOk ? waMeLink(digitsOk) : null
  const emailPrimary = selected ? primaryEmail(selected) : null

  return (
    <div className="animate-fade-in max-w-6xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">CRM</p>
          <h2 className="text-xl font-semibold text-slate-100 tracking-tight mt-0.5">Клиенты и WhatsApp</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Список слева — как в мессенджер‑CRM: выберите компанию, справа — шаблон, ссылка wa.me и журнал.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {onOpenWhatsApp ? (
            <button
              type="button"
              onClick={onOpenWhatsApp}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-[#25D366]/35 bg-[#25D366]/10 px-4 py-2.5 text-sm font-medium text-[#25D366] hover:bg-[#25D366]/15 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
              </svg>
              Лента WhatsApp
            </button>
          ) : null}
          <button
            type="button"
            onClick={onBrowseLeads}
            className="shrink-0 rounded-xl border border-white/[0.1] bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/[0.04] hover:text-white transition-colors"
          >
            Все лиды в таблице
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row min-h-[min(72vh,640px)] rounded-2xl border border-white/[0.08] bg-slate-950/50 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] overflow-hidden">
        {/* Список клиентов */}
        <aside className="flex flex-col w-full lg:w-[min(100%,320px)] lg:max-w-[340px] shrink-0 border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-[#070b14]/90">
          <div className="px-4 pt-4 pb-3 border-b border-white/[0.05]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs font-semibold text-slate-400">База</span>
              <span className="text-[10px] tabular-nums text-slate-600">{pickerLeads.length} в выборке</span>
            </div>
            <div className="relative">
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Поиск: имя, БИН, телефон…"
                className="w-full rounded-xl border border-white/[0.08] bg-slate-900/90 pl-10 pr-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500/35 focus:ring-1 focus:ring-sky-500/15"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-[200px] lg:min-h-0">
            {pickerLoading ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">Загрузка…</p>
            ) : pickerError ? (
              <p className="px-4 py-6 text-center text-xs text-rose-400" role="alert">
                {pickerError}
              </p>
            ) : pickerLeads.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500 leading-relaxed">
                Нет компаний по запросу. Добавьте лиды через 2GIS или сбросьте поиск.
              </p>
            ) : (
              <ul className="p-2 space-y-0.5">
                {pickerLeads.map((l) => {
                  const active = selected?.id === l.id
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => void loadLeadDetail(l)}
                        className={`w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'bg-sky-500/12 ring-1 ring-sky-500/25'
                            : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 border border-white/[0.06] flex items-center justify-center text-xs font-bold text-slate-300">
                          {initials(l.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-slate-100 truncate">{l.name || '—'}</span>
                            <span
                              className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${statusPillClass(l.status)}`}
                            >
                              {leadStatusLabel(l.status)}
                            </span>
                          </span>
                          <span className="block text-[11px] text-slate-500 mt-0.5 truncate">
                            {l.city || '—'} · БИН {l.bin || '—'}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Карточка + действия */}
        <section className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-[#0c1220] to-[#080c14]">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-white/[0.06] flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500" aria-hidden>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-400">Выберите клиента слева</p>
              <p className="text-xs text-slate-600 mt-2 max-w-xs">
                Откроется карточка, телефон для WhatsApp и шаблоны сообщений.
              </p>
            </div>
          ) : (
            <>
              <header className="shrink-0 px-5 sm:px-6 py-4 border-b border-white/[0.06] bg-slate-950/40">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-600/30 to-cyan-900/40 border border-sky-500/20 flex items-center justify-center text-sm font-bold text-sky-200">
                      {initials(selected.name)}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-white truncate">{selected.name || '—'}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selected.city || '—'} · БИН {selected.bin || '—'}
                      </p>
                      {phone ? (
                        <p className="text-xs font-mono text-slate-400 mt-1 truncate" title={phone}>
                          {phone}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-500/90 mt-1">Телефон не указан — задайте в блоке сообщения</p>
                      )}
                      {emailPrimary ? (
                        <p className="text-xs text-sky-400/90 mt-0.5 truncate" title={emailPrimary}>
                          {emailPrimary}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-600 mt-0.5">Почта не указана — введите в вкладке «Почта»</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] px-2.5 py-1 rounded-lg font-medium ${statusPillClass(selected.status)}`}>
                      {leadStatusLabel(selected.status)}
                    </span>
                    {waQuick ? (
                      <a
                        href={waQuick}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-xs font-semibold text-[#05301f] hover:bg-[#20bd5a] transition-colors shadow-lg shadow-emerald-900/20"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                        </svg>
                        Чат
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="rounded-xl border border-white/[0.1] px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
                {detailLoading ? (
                  <p className="text-[11px] text-sky-400/80 mt-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    Обновление карточки…
                  </p>
                ) : null}
              </header>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
                <WhatsAppConnectPanel compact />
                <OutreachCrmForm
                  leadId={selected.id}
                  leadEmail={primaryEmail(selected)}
                  historyMaxClass="max-h-52"
                  variant="embedded"
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
