import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Lead } from '../types'
import { apiUrl } from '../apiBase'
import { leadStatusLabel } from '../lib/lead-ui'
import { primaryEmail } from '../lib/lead-contact'
import { OutreachCrmForm } from './OutreachCrmForm'

function digitsForWa(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1)
  if (d.length === 10) d = '7' + d
  if (d.length === 11 && d.startsWith('7')) return d
  return d.length >= 10 ? d : null
}

function waMeUrl(digits: string, text?: string) {
  const base = `https://wa.me/${digits}`
  return text?.trim() ? `${base}?text=${encodeURIComponent(text.slice(0, 1800))}` : base
}

/** 2GIS often stores `whatsapp` as wa.me URL; contacts use raw phone digits. */
function digitsFromWhatsAppField(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const t = raw.trim()
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t)
      const seg = u.pathname.split('/').filter(Boolean)[0]
      if (seg) return digitsForWa(seg)
    } catch {
      /* fall through */
    }
  }
  return digitsForWa(t)
}

/** Best-effort wa.me / link for the sticky strip (company field or first contact phone). */
function quickWhatsAppHref(lead: Lead): string | null {
  const wd = digitsFromWhatsAppField(lead.whatsapp)
  if (wd) return waMeUrl(wd)
  const raw = lead.whatsapp?.trim()
  if (raw?.startsWith('http')) return raw
  for (const c of lead.contacts ?? []) {
    const d = digitsForWa(c.phone || undefined)
    if (d) return waMeUrl(d)
  }
  return null
}

function websiteHostname(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  const t = url.trim()
  try {
    const u = new URL(t.startsWith('http') ? t : `https://${t}`)
    return u.hostname.replace(/^www\./, '') || null
  } catch {
    return t.length > 40 ? `${t.slice(0, 38)}…` : t
  }
}

function websiteHref(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  const t = url.trim()
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SnapshotRow({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <dt className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-100 font-medium break-words">{children}</dd>
    </div>
  )
}

function sourceBadgeClass(source: string | null) {
  const n = (source || '').toLowerCase()
  if (n === '2gis') return 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25'
  if (n === 'manual') return 'bg-indigo-500/12 text-indigo-300 border-indigo-500/25'
  return 'bg-slate-500/12 text-slate-400 border-slate-500/20'
}

function CompanySnapshot({ lead }: { lead: Lead }) {
  const siteHost = websiteHostname(lead.website)
  const siteHref = websiteHref(lead.website)
  const phones = Array.from(
    new Set(
      (lead.contacts ?? [])
        .map((c) => c.phone?.trim() || '')
        .filter(Boolean),
    ),
  )
  const primaryEmail =
    lead.email?.trim() || lead.contacts?.find((c) => c.email?.trim())?.email?.trim()
  const ratingN = Number(lead.rating2gis || 0)
  const stars = Number.isFinite(ratingN) ? Math.min(5, Math.max(0, Math.round(ratingN))) : 0
  const okedLine =
    [lead.okedCode, lead.okedName].filter(Boolean).join(' — ') || null

  return (
    <section className="rounded-2xl border border-white/[0.1] bg-gradient-to-b from-slate-950/80 to-slate-950/40 p-5 sm:p-6 shadow-lg shadow-black/20">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="workspace-label mb-0">Кратко</h3>
        <p className="text-[11px] text-slate-500 leading-snug sm:max-w-[55%] sm:text-right">
          Данные из вашей базы и скраперов; дубликаты карточек ниже не показываются.
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-3.5">
        <SnapshotRow label="Город">{lead.city?.trim() || '—'}</SnapshotRow>
        <SnapshotRow label="Адрес">{lead.address?.trim() || '—'}</SnapshotRow>
        <SnapshotRow label="Категория (сбор)">{lead.category?.trim() || 'Без категории'}</SnapshotRow>
        <SnapshotRow label="2GIS (рубрики на карточке)">
          <span className="text-[13px] text-slate-200 leading-snug">{lead.twogisCardCategory?.trim() || '—'}</span>
        </SnapshotRow>
        <SnapshotRow label="БИН">
          <span className="font-mono text-slate-200 inline-flex items-center gap-2 flex-wrap">
            {lead.bin || '—'}
            <CopyButton value={lead.bin} />
          </span>
        </SnapshotRow>
        {okedLine ? (
          <SnapshotRow label="ОКЭД" className="sm:col-span-2">
            <span className="text-[13px] text-slate-200">{okedLine}</span>
          </SnapshotRow>
        ) : null}
        {lead.legalStatus?.trim() ? (
          <SnapshotRow label="Правовой статус">
            <span className="text-amber-200/90 text-sm font-semibold">{lead.legalStatus}</span>
          </SnapshotRow>
        ) : null}
        <SnapshotRow label="Сайт">
          {siteHost && siteHref ? (
            <a
              href={siteHref}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm text-sky-300 hover:text-sky-200 underline decoration-sky-500/40"
            >
              {siteHost}
            </a>
          ) : (
            '—'
          )}
        </SnapshotRow>
        <SnapshotRow label="Почта">
          {primaryEmail ? (
            <span className="inline-flex items-center gap-2 flex-wrap break-all">
              <a href={`mailto:${primaryEmail}`} className="text-sky-300 hover:text-sky-200 underline">
                {primaryEmail}
              </a>
              <CopyButton value={primaryEmail} />
            </span>
          ) : (
            '—'
          )}
        </SnapshotRow>
        <SnapshotRow label={phones.length > 1 ? `Телефоны (${phones.length})` : 'Телефон'}>
          {phones.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {phones.map((p) => (
                <span key={p} className="inline-flex items-center gap-2 flex-wrap font-mono">
                  {p}
                  <CopyButton value={p} />
                </span>
              ))}
            </div>
          ) : (
            '—'
          )}
        </SnapshotRow>
        <SnapshotRow label="2GIS">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-black text-amber-500 tabular-nums">
                {lead.rating2gis?.trim() ? lead.rating2gis : '—'}
              </span>
              <div className="flex gap-0.5" aria-hidden>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full ${i <= stars ? 'bg-amber-500' : 'bg-slate-800'}`}
                  />
                ))}
              </div>
              {lead.reviewsCount2gis != null && lead.reviewsCount2gis > 0 ? (
                <span className="text-xs text-slate-500">{lead.reviewsCount2gis} отзывов</span>
              ) : null}
            </div>
            {lead.sourceUrl?.trim() ? (
              <a
                href={lead.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline"
              >
                Открыть карточку в 2GIS
              </a>
            ) : (
              <span className="text-xs text-slate-600">Ссылка на 2GIS не сохранена</span>
            )}
          </div>
        </SnapshotRow>
        <SnapshotRow label="Источник">
          <span
            className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${sourceBadgeClass(lead.source)}`}
          >
            {lead.source || 'Неизвестно'}
          </span>
        </SnapshotRow>
        <SnapshotRow label="Этап (воронка)">
          <span className="font-black uppercase text-xs tracking-widest text-brand-400">{leadStatusLabel(lead.status, { whenEmpty: 'dash' })}</span>
        </SnapshotRow>
        <SnapshotRow label="ICP, балл (0–100)">
          {lead.icpScore != null && lead.icpScore > 0 ? (
            <span className="tabular-nums text-lg font-black text-indigo-300">{lead.icpScore}</span>
          ) : (
            <span className="text-slate-500 text-sm">Не задано</span>
          )}
        </SnapshotRow>
        <SnapshotRow label="Добавлено в БД">{formatWhen(lead.createdAt)}</SnapshotRow>
        <SnapshotRow label="Последнее обогащение">{formatWhen(lead.lastEnrichedAt)}</SnapshotRow>
        <SnapshotRow label="Последний скрапинг">{formatWhen(lead.lastScrapedAt)}</SnapshotRow>
      </dl>
    </section>
  )
}

interface Props {
  lead: Lead | null
  onClose: () => void
}

const CopyButton = ({ value }: { value?: string | number | null }) => {
  if (!value) return null;
  return (
    <button 
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value.toString());
      }}
      className="p-1.5 text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 rounded-lg transition-all"
      title="Копировать"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
    </button>
  );
};

const SocialIcon = ({ type }: { type: string }) => {
  switch (type.toLowerCase()) {
    case 'facebook': return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>;
    case 'vk': return <span className="text-[10px] font-black">VK</span>;
    case 'twitter': return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>;
    case 'youtube': return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17Z"/><path d="m10 15 5-3-5-3z"/></svg>;
    default: return null;
  }
};

export function LeadSidePanel({ lead: initialLead, onClose }: Props) {
  const [lead, setLead] = useState<Lead | null>(initialLead)
  const [loading, setLoading] = useState(!!initialLead)
  const [crmOpen, setCrmOpen] = useState(true)

  useEffect(() => {
    if (!initialLead) return
    let cancelled = false
    fetch(apiUrl(`/api/companies/${initialLead.id}`))
      .then(res => res.json())
      .then(data => { if (!cancelled) setLead(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [initialLead])

  useEffect(() => {
    setCrmOpen(true)
  }, [initialLead?.id])

  const isOpen = !!initialLead
  const displayLead = lead || initialLead

  const quickWa = useMemo(
    () => (displayLead ? quickWhatsAppHref(displayLead) : null),
    [displayLead],
  )

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="side-panel-mask opacity-100"
          onClick={onClose}
        ></div>
      )}
      
      {/* Panel */}
      <div className={`side-panel ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {displayLead && (
          <div className="side-panel-content flex h-full flex-col p-6 sm:p-8">
            {/* Header */}
            <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
              <div className="flex min-w-0 gap-4 sm:gap-5 items-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl bg-brand-500/10 flex items-center justify-center text-xl sm:text-2xl font-black text-brand-400 border border-brand-500/20 shadow-inner">
                  {displayLead.name?.[0] || '?'}
                </div>
                <div className="min-w-0 space-y-2">
                  <h2 className="text-lg sm:text-xl font-black text-white leading-tight break-words">{displayLead.name}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${sourceBadgeClass(displayLead.source)}`}
                    >
                      {displayLead.source || 'Неизвестно'}
                    </span>
                    <span className="rounded-md border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-brand-400">
                      {leadStatusLabel(displayLead.status, { whenEmpty: 'dash' })}
                    </span>
                    {displayLead.city?.trim() ? (
                      <span className="text-[11px] font-medium text-slate-500 truncate max-w-[12rem]" title={displayLead.city}>
                        {displayLead.city}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-3 text-slate-500 hover:text-white hover:bg-white/5 rounded-2xl transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            <div className="mb-4 shrink-0 rounded-2xl border border-emerald-500/30 bg-emerald-950/35 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-emerald-100">Связаться</p>
                  <p className="text-xs text-emerald-200/70 mt-0.5 max-w-md">
                    Откройте WhatsApp, если есть номер. Полный CRM (шаблоны, очередь, журнал) {crmOpen ? 'ниже на странице.' : '— разверните блок.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {quickWa ? (
                    <a
                      href={quickWa}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      Открыть WhatsApp
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">Нет телефона или ссылки wa.me</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setCrmOpen((v) => !v)}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                  >
                    {crmOpen ? 'Скрыть полный CRM' : 'Показать полный CRM'}
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-8 overflow-y-auto pb-4 pr-1">
              <CompanySnapshot lead={displayLead} />

              <div className="border-t border-white/[0.06] pt-6">
                <h3 className="workspace-label mb-4">CRM и сообщения</h3>
                {crmOpen && displayLead.id ? (
                  <OutreachCrmForm leadId={displayLead.id} leadEmail={primaryEmail(displayLead)} />
                ) : (
                  <p className="text-xs text-slate-500">Включите «Показать полный CRM» выше, чтобы загрузить формы рассылки.</p>
                )}
              </div>

              {((displayLead.enrichmentSources && Object.keys(displayLead.enrichmentSources).length > 0) ||
                displayLead.openingHours) && (
                <div className="space-y-6 border-t border-white/[0.06] pt-6">
                  {displayLead.enrichmentSources && Object.keys(displayLead.enrichmentSources).length > 0 ? (
                    <div>
                      <h3 className="workspace-label">Запуски обогащения</h3>
                      <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 space-y-3">
                        {Object.entries(displayLead.enrichmentSources).map(([source, info]) => {
                          const st = (info as { status?: string })?.status ?? '—'
                          const stLower = String(st).toLowerCase()
                          const stLabel =
                            st === '—'
                              ? '—'
                              : stLower === 'ok' || stLower === 'success'
                                ? 'Успех'
                                : stLower === 'error' || stLower === 'failed'
                                  ? 'Ошибка'
                                  : String(st)
                          return (
                            <div key={source} className="flex items-center justify-between">
                              <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{source}</span>
                              <span
                                className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                                  stLower === 'ok' || stLower === 'success'
                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                }`}
                              >
                                {stLabel}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}

                  {displayLead.openingHours ? (
                    <div>
                      <h3 className="workspace-label">Часы работы</h3>
                      <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 space-y-2">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          В карточке
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="space-y-6 border-t border-white/[0.06] pt-6">
                <div>
                   <h3 className="workspace-label">Соцсети и ссылки</h3>
                   <div className="grid grid-cols-4 gap-3">
                      {(['facebook', 'vk', 'twitter', 'youtube'] as const).map(social => {
                        const val = displayLead?.[social];
                        if (!val) return null;
                        return (
                          <a key={social} href={val} target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center p-4 bg-slate-900 border border-white/5 rounded-2xl hover:border-brand-500/50 hover:bg-brand-500/10 transition-all text-slate-400 hover:text-brand-400 group">
                            <SocialIcon type={social} />
                          </a>
                        );
                      })}
                   </div>
                </div>

                <div>
                  <h3 className="workspace-label">Все контакты</h3>
                  <div className="space-y-3">
                    {loading ? (
                      <div className="p-8 border border-white/5 border-dashed rounded-[2rem] animate-pulse text-center">
                        <span className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em]">Загрузка контактов…</span>
                      </div>
                    ) : (
                      <>
                        {(displayLead.whatsapp || displayLead.telegram || displayLead.instagram) && (
                          <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Мессенджеры компании</span>
                              {displayLead.whatsapp ? <CopyButton value={displayLead.whatsapp} /> : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(() => {
                                const waDigits = digitsFromWhatsAppField(displayLead.whatsapp)
                                const waHref = waDigits ? waMeUrl(waDigits) : displayLead.whatsapp?.trim().startsWith('http') ? displayLead.whatsapp : null
                                return waHref ? (
                                  <a
                                    href={waHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-2 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/25 hover:bg-emerald-500/25"
                                  >
                                    WhatsApp
                                  </a>
                                ) : null
                              })()}
                              {displayLead.telegram?.trim() && (
                                <a
                                  href={(() => {
                                    const tg = displayLead.telegram!.trim()
                                    if (/^https?:\/\//i.test(tg)) return tg
                                    if (tg.includes('t.me/')) return `https://${tg.replace(/^\/+/, '')}`
                                    return `https://t.me/${tg.replace(/^@/, '')}`
                                  })()}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 rounded-xl bg-sky-500/15 px-3 py-2 text-[10px] font-bold text-sky-300 ring-1 ring-sky-500/25 hover:bg-sky-500/25"
                                >
                                  Telegram
                                </a>
                              )}
                              {displayLead.instagram?.trim() && (
                                <a
                                  href={displayLead.instagram.trim().startsWith('http') ? displayLead.instagram : `https://instagram.com/${displayLead.instagram.replace(/^@/, '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-500/30 px-3 py-2 text-[10px] font-bold text-fuchsia-300 hover:bg-fuchsia-500/10"
                                >
                                  Instagram
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                        {displayLead.contacts?.map((contact, i) => {
                          const d = digitsForWa(contact.phone || undefined)
                          const href = d ? waMeUrl(d) : null
                          return (
                          <div key={i} className="group/contact flex items-center justify-between p-5 bg-slate-950/30 border border-white/5 rounded-3xl hover:border-brand-500/30 transition-all">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-mono font-bold text-white">{contact.phone || contact.email}</span>
                                <CopyButton value={contact.phone || contact.email} />
                              </div>
                              <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{contact.fullName || 'Контакт'}</span>
                            </div>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="px-4 py-2 bg-brand-500/10 hover:bg-brand-500 text-brand-400 hover:text-white text-[9px] font-black rounded-xl transition-all uppercase tracking-widest border border-brand-500/20 text-center"
                              >
                                WhatsApp
                              </a>
                            ) : (
                              <span className="text-[8px] font-bold text-slate-600 uppercase">Нет телефона</span>
                            )}
                          </div>
                        )})}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {displayLead.lat && displayLead.lng && (
                <div className="border-t border-white/[0.06] pt-6">
                  <h3 className="workspace-label">На карте</h3>
                  <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 flex items-center justify-between">
                     <div className="flex flex-col gap-1">
                       <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">Координаты</span>
                       <span className="text-[10px] font-mono text-slate-400 font-bold">{displayLead.lat}, {displayLead.lng}</span>
                     </div>
                     <button className="p-3 bg-slate-900 rounded-2xl border border-white/5 text-slate-400 hover:text-brand-400 transition-all">
                       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                     </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-auto flex shrink-0 gap-4 border-t border-white/5 pt-10">
              <button
                type="button"
                className="flex-1 rounded-2xl border border-white/5 bg-slate-900 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 transition-all hover:bg-slate-800 hover:text-white"
              >
                В архив
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
