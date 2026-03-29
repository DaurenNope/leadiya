import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../hooks/useToast'
import { apiUrl } from '../apiBase'
import { phoneDigitsForWa, waMeLink } from '../lib/wa-link'
import { buildMailtoUrl, splitEmailTemplate } from '../lib/mailto'
import { formatSequenceDelay } from '../lib/sequence-ui'

function sequenceOptionLabel(key: string): string {
  const known: Record<string, string> = {
    cold_outreach: 'Холодная рассылка',
  }
  return known[key] ?? key
}

export type OutreachLogRow = {
  id: string
  channel: string
  direction: string
  body: string | null
  status: string | null
  createdAt: string
}

type Props = {
  leadId: string
  /** Email из карточки лида (компания или контакт) — подставляется в почту. */
  leadEmail?: string | null
  historyMaxClass?: string
  variant?: 'standalone' | 'embedded'
}

function channelLabel(ch: string) {
  const c = ch.toLowerCase()
  if (c === 'whatsapp') return 'WhatsApp'
  if (c === 'email') return 'Почта'
  return ch
}

export function OutreachCrmForm({
  leadId,
  leadEmail = null,
  historyMaxClass = 'max-h-44',
  variant = 'standalone',
}: Props) {
  const { toast } = useToast()
  const [sequenceKeys, setSequenceKeys] = useState<string[]>([])
  const [sequenceKey, setSequenceKey] = useState('cold_outreach')
  const [waStepIndex, setWaStepIndex] = useState(0)
  const [emailStepIndex, setEmailStepIndex] = useState(-1)

  const [channelTab, setChannelTab] = useState<'whatsapp' | 'email'>('whatsapp')
  const [logFilter, setLogFilter] = useState<'all' | 'whatsapp' | 'email'>('all')

  const [draftBody, setDraftBody] = useState('')
  const [waLink, setWaLink] = useState<string | null>(null)
  const [phoneDigits, setPhoneDigits] = useState<string | null>(null)
  const [phoneInput, setPhoneInput] = useState('')

  const [emailDraft, setEmailDraft] = useState('')
  const [emailToInput, setEmailToInput] = useState('')

  const [baileysSend, setBaileysSend] = useState(false)
  const [emailApiSend, setEmailApiSend] = useState(false)
  const [outreachBusy, setOutreachBusy] = useState(false)
  const [outreachLogs, setOutreachLogs] = useState<OutreachLogRow[]>([])
  const [sequenceSteps, setSequenceSteps] = useState<{ id: string; channel: string; delay?: unknown }[]>([])
  const [scheduleDelayMs, setScheduleDelayMs] = useState(3_600_000)

  const refreshOutreachLogs = useCallback((id: string) => {
    fetch(apiUrl(`/api/outreach/log?leadId=${encodeURIComponent(id)}&limit=120`))
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: OutreachLogRow[] }) => setOutreachLogs(d.items ?? []))
      .catch(() => setOutreachLogs([]))
  }, [])

  useEffect(() => {
    fetch(apiUrl('/api/outreach/sequences'))
      .then((r) => (r.ok ? r.json() : { sequences: [] }))
      .then((d: { sequences?: { key: string }[] }) => {
        const keys = (d.sequences ?? []).map((s) => s.key)
        if (keys.length) setSequenceKeys(keys)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(apiUrl('/api/outreach/business'))
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { whatsapp_baileys_send?: boolean; email_api_send?: boolean }) => {
        setBaileysSend(!!d.whatsapp_baileys_send)
        setEmailApiSend(!!d.email_api_send)
      })
      .catch(() => {
        setBaileysSend(false)
        setEmailApiSend(false)
      })
  }, [])

  useEffect(() => {
    fetch(apiUrl(`/api/outreach/sequences/${encodeURIComponent(sequenceKey)}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((seq: { steps?: { id?: string; channel: string; delay?: unknown }[] } | null) => {
        const steps = seq?.steps ?? []
        setSequenceSteps(
          steps.map((s, i) => ({
            id: s.id || `step_${i}`,
            channel: s.channel,
            delay: s.delay,
          })),
        )
        const wi = steps.findIndex((s) => s.channel === 'whatsapp')
        const ei = steps.findIndex((s) => s.channel === 'email')
        setWaStepIndex(wi >= 0 ? wi : 0)
        setEmailStepIndex(ei >= 0 ? ei : -1)
      })
      .catch(() => {
        setSequenceSteps([])
        setWaStepIndex(0)
        setEmailStepIndex(-1)
      })
  }, [sequenceKey])

  useEffect(() => {
    setPhoneDigits(null)
    setWaLink(null)
    setDraftBody('')
    setPhoneInput('')
    setEmailDraft('')
    setEmailToInput(leadEmail?.trim() || '')
  }, [leadId, leadEmail])

  const effectiveDigits = useMemo(
    () => phoneDigitsForWa(phoneInput) || phoneDigits || null,
    [phoneInput, phoneDigits],
  )

  const openWhatsAppHref = useMemo(() => {
    if (waLink) return waLink
    if (!effectiveDigits) return null
    return draftBody.trim() ? waMeLink(effectiveDigits, draftBody) : waMeLink(effectiveDigits)
  }, [waLink, effectiveDigits, draftBody])

  const emailMailtoHref = useMemo(() => {
    const to = emailToInput.trim()
    if (!to || !emailDraft.trim()) return null
    const { subject, body } = splitEmailTemplate(emailDraft)
    return buildMailtoUrl(to, body, subject)
  }, [emailToInput, emailDraft])

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return outreachLogs
    return outreachLogs.filter((r) => (r.channel || '').toLowerCase() === logFilter)
  }, [outreachLogs, logFilter])

  useEffect(() => {
    refreshOutreachLogs(leadId)
  }, [leadId, refreshOutreachLogs])

  const shell =
    variant === 'embedded'
      ? 'space-y-5 rounded-xl border border-white/[0.07] bg-slate-950/35 p-5 sm:p-6'
      : 'space-y-4 rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-5 ring-1 ring-emerald-500/10'

  return (
    <div className={shell}>
      <div className="border-b border-white/[0.06] pb-4">
        <h3 className="text-sm font-semibold text-slate-100">Журнал коммуникаций</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">WhatsApp и почта по этому лиду (outreach_log)</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {(['all', 'whatsapp', 'email'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setLogFilter(f)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                logFilter === f
                  ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/30'
                  : 'bg-white/[0.04] text-slate-500 hover:text-slate-300'
              }`}
            >
              {f === 'all' ? 'Все' : f === 'whatsapp' ? 'WhatsApp' : 'Почта'}
            </button>
          ))}
        </div>
        {filteredLogs.length > 0 ? (
          <ul className={`${historyMaxClass} mt-3 space-y-2 overflow-y-auto pr-1`}>
            {filteredLogs.map((row) => (
              <li key={row.id} className="rounded-xl border border-white/[0.06] bg-slate-900/50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  <span
                    className={`font-bold ${
                      (row.channel || '').toLowerCase() === 'whatsapp'
                        ? 'text-[#25D366]'
                        : (row.channel || '').toLowerCase() === 'email'
                          ? 'text-sky-400'
                          : 'text-slate-400'
                    }`}
                  >
                    {channelLabel(row.channel)}
                  </span>
                  <span className="text-slate-600">
                    {row.direction === 'inbound' ? '← вх.' : '→ исх.'}
                  </span>
                  <span className="text-slate-600">{row.status || '—'}</span>
                  <span className="text-slate-600 tabular-nums ml-auto">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString('ru-RU') : ''}
                  </span>
                </div>
                {row.body ? (
                  <p className="mt-1 text-xs text-slate-400 line-clamp-3 whitespace-pre-wrap break-words">{row.body}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-slate-600">Записей по фильтру пока нет — отправьте сообщение ниже и нажмите «В журнал».</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Цепочка (sequence)</label>
        <select
          value={sequenceKey}
          onChange={(e) => setSequenceKey(e.target.value)}
          className="rounded-xl border border-white/[0.1] bg-slate-900/80 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-500/35"
        >
          {(sequenceKeys.length ? sequenceKeys : ['cold_outreach']).map((k) => (
            <option key={k} value={k}>
              {sequenceOptionLabel(k)}
            </option>
          ))}
        </select>
      </div>

      {sequenceSteps.length > 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-slate-900/30 p-3">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Шаги цепочки</p>
          <ol className="flex flex-wrap gap-2">
            {sequenceSteps.map((s, i) => (
              <li
                key={`${s.id}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-slate-950/60 px-2.5 py-1.5 text-[11px]"
              >
                <span
                  className={`font-bold ${
                    s.channel === 'whatsapp' ? 'text-[#25D366]' : s.channel === 'email' ? 'text-sky-400' : 'text-slate-400'
                  }`}
                >
                  {s.channel === 'whatsapp' ? 'WA' : s.channel === 'email' ? 'Email' : s.channel}
                </span>
                <span className="text-slate-500">{formatSequenceDelay(s.delay)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="flex rounded-xl border border-white/[0.08] p-1 bg-slate-900/40">
        <button
          type="button"
          onClick={() => setChannelTab('whatsapp')}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
            channelTab === 'whatsapp' ? 'bg-[#25D366]/20 text-[#25D366]' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          WhatsApp
        </button>
        <button
          type="button"
          onClick={() => setChannelTab('email')}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
            channelTab === 'email' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Почта
        </button>
      </div>

      {channelTab === 'whatsapp' ? (
        <>
          {variant === 'standalone' ? (
            <p className="text-xs text-slate-500 leading-relaxed -mt-2">
              Шаг цепочки с каналом WhatsApp (обычно первый). <strong className="text-slate-400">wa.me</strong> без Baileys.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Телефон</label>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+7 777 123 4567"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="rounded-xl border border-white/[0.1] bg-slate-900/80 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-[#25D366]/40"
              />
              {effectiveDigits ? (
                <p className="text-[11px] text-slate-600">wa.me: {effectiveDigits}</p>
              ) : (
                <p className="text-[11px] text-amber-500/90">Нужен номер для ссылки</p>
              )}
            </div>
            <div className="flex flex-col justify-end">
              <p className="text-[11px] text-slate-600">
                Шаг в цепочке: <span className="text-slate-400 font-mono">{waStepIndex + 1}</span> (WhatsApp)
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={outreachBusy}
            onClick={async () => {
              setOutreachBusy(true)
              try {
                const override = phoneInput.trim() ? phoneInput.trim() : undefined
                const res = await fetch(apiUrl('/api/outreach/preview'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    leadId,
                    sequenceKey,
                    stepIndex: waStepIndex,
                    phoneOverride: override,
                  }),
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Предпросмотр не удался')
                if (data.channel !== 'whatsapp') {
                  toast('Этот шаг не WhatsApp — переключите цепочку или вкладку', 'info')
                  return
                }
                setDraftBody(data.body || '')
                setWaLink(data.waLink || null)
                const resolved = (data as { phoneDigits?: string | null }).phoneDigits ?? null
                setPhoneDigits(resolved)
                if (resolved && !phoneInput.trim()) setPhoneInput(resolved)
                if (!data.waLink && !resolved) {
                  toast('Нет телефона — введите номер и снова «Собрать текст»', 'info')
                }
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Предпросмотр не удался', 'error')
              } finally {
                setOutreachBusy(false)
              }
            }}
            className="w-full rounded-xl bg-slate-800 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50 border border-white/[0.06]"
          >
            Собрать текст WhatsApp
          </button>
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={variant === 'embedded' ? 6 : 7}
            className="w-full resize-y rounded-xl border border-white/[0.08] bg-slate-900/60 p-4 text-sm text-slate-200 placeholder:text-slate-600 leading-relaxed outline-none focus:border-sky-500/30"
            placeholder="Текст сообщения…"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(draftBody)
                toast('Скопировано', 'success')
              }}
              className="flex-1 min-w-[100px] rounded-xl border border-white/[0.1] py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.04]"
            >
              Копировать
            </button>
            {openWhatsAppHref ? (
              <a
                href={openWhatsAppHref}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] py-2.5 text-center text-xs font-bold text-[#05301f] hover:bg-[#20bd5a] shadow-md shadow-emerald-950/30"
              >
                WhatsApp
              </a>
            ) : null}
            {baileysSend && effectiveDigits && draftBody.trim() ? (
              <button
                type="button"
                disabled={outreachBusy}
                onClick={async () => {
                  setOutreachBusy(true)
                  try {
                    const res = await fetch(apiUrl('/api/outreach/send'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        leadId,
                        sequenceKey,
                        stepIndex: waStepIndex,
                        body: draftBody,
                        phoneOverride: phoneInput.trim() || undefined,
                      }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error((data as { error?: string }).error || 'Очередь не приняла запрос')
                    toast('В очередь WhatsApp (Baileys)', 'success')
                    refreshOutreachLogs(leadId)
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Ошибка очереди', 'error')
                  } finally {
                    setOutreachBusy(false)
                  }
                }}
                className="flex-1 min-w-[120px] rounded-xl bg-violet-600 py-2.5 text-center text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                В очередь
              </button>
            ) : null}
            <button
              type="button"
              disabled={!draftBody.trim()}
              onClick={async () => {
                try {
                  const res = await fetch(apiUrl('/api/outreach/log'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      leadId,
                      channel: 'whatsapp',
                      direction: 'outbound',
                      body: draftBody,
                      status: 'sent',
                    }),
                  })
                  if (!res.ok) throw new Error('Запись не удалась')
                  toast('Записано в журнал', 'success')
                  refreshOutreachLogs(leadId)
                } catch {
                  toast('Не удалось записать', 'error')
                }
              }}
              className="flex-1 min-w-[100px] rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40"
            >
              В журнал
            </button>
          </div>
          {baileysSend && effectiveDigits && draftBody.trim() ? (
            <div className="rounded-xl border border-violet-500/20 bg-violet-950/25 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-violet-200/90">Отложенная отправка (очередь Redis)</p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={scheduleDelayMs}
                  onChange={(e) => setScheduleDelayMs(Number(e.target.value))}
                  className="flex-1 min-w-[140px] rounded-lg border border-white/[0.1] bg-slate-900/80 px-2 py-2 text-[11px] text-slate-200"
                >
                  <option value={3_600_000}>Через 1 ч</option>
                  <option value={10_800_000}>Через 3 ч</option>
                  <option value={86_400_000}>Через 24 ч</option>
                  <option value={259_200_000}>Через 3 дн</option>
                  <option value={604_800_000}>Через 7 дн</option>
                </select>
                <button
                  type="button"
                  disabled={outreachBusy}
                  onClick={async () => {
                    setOutreachBusy(true)
                    try {
                      const res = await fetch(apiUrl('/api/outreach/schedule'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          leadId,
                          sequenceKey,
                          stepIndex: waStepIndex,
                          body: draftBody,
                          phoneOverride: phoneInput.trim() || undefined,
                          delayMs: scheduleDelayMs,
                        }),
                      })
                      const data = await res.json()
                      if (!res.ok) throw new Error((data as { error?: string }).error || 'Планирование не удалось')
                      toast(`Запланировано (~${Math.round(scheduleDelayMs / 3_600_000)} ч)`, 'success')
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Ошибка планирования', 'error')
                    } finally {
                      setOutreachBusy(false)
                    }
                  }}
                  className="rounded-lg bg-violet-700/90 px-3 py-2 text-[11px] font-semibold text-white hover:bg-violet-600 disabled:opacity-50"
                >
                  Запланировать WA
                </button>
              </div>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Воркер Baileys отправит после задержки (лимиты из business.yml по-прежнему действуют).
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {emailStepIndex < 0 ? (
            <p className="text-sm text-amber-400/90 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              В выбранной цепочке нет шага с каналом <strong>email</strong>. Выберите другую цепочку или добавьте шаг в{' '}
              <code className="text-amber-200/90">sequences.yml</code>.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Кому (email)</label>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="client@company.kz"
                  value={emailToInput}
                  onChange={(e) => setEmailToInput(e.target.value)}
                  className="rounded-xl border border-white/[0.1] bg-slate-900/80 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-sky-500/35"
                />
                <p className="text-[11px] text-slate-600">
                  Шаг в цепочке: <span className="font-mono text-slate-400">{emailStepIndex + 1}</span> (email)
                </p>
              </div>

              <button
                type="button"
                disabled={outreachBusy}
                onClick={async () => {
                  setOutreachBusy(true)
                  try {
                    const res = await fetch(apiUrl('/api/outreach/preview'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        leadId,
                        sequenceKey,
                        stepIndex: emailStepIndex,
                        emailOverride: emailToInput.trim() || undefined,
                      }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Предпросмотр не удался')
                    if (data.channel !== 'email') {
                      toast('Этот шаг не email', 'info')
                      return
                    }
                    setEmailDraft(data.body || '')
                    if ((data as { emailTo?: string | null }).emailTo && !emailToInput.trim()) {
                      setEmailToInput((data as { emailTo: string }).emailTo)
                    }
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'Предпросмотр не удался', 'error')
                  } finally {
                    setOutreachBusy(false)
                  }
                }}
                className="w-full rounded-xl bg-slate-800 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50 border border-white/[0.06]"
              >
                Собрать текст письма
              </button>
              <textarea
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                rows={variant === 'embedded' ? 8 : 9}
                className="w-full resize-y rounded-xl border border-white/[0.08] bg-slate-900/60 p-4 text-sm text-slate-200 placeholder:text-slate-600 leading-relaxed outline-none focus:border-sky-500/30 font-mono text-[13px]"
                placeholder={'Тема: …\n\nТекст письма…'}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(emailDraft)
                    toast('Скопировано', 'success')
                  }}
                  className="flex-1 min-w-[100px] rounded-xl border border-white/[0.1] py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.04]"
                >
                  Копировать
                </button>
                {emailMailtoHref ? (
                  <a
                    href={emailMailtoHref}
                    className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-center text-xs font-bold text-white hover:bg-sky-500"
                  >
                    Открыть в почте
                  </a>
                ) : null}
                {emailApiSend && emailToInput.trim() && emailDraft.trim() ? (
                  <button
                    type="button"
                    disabled={outreachBusy}
                    onClick={async () => {
                      setOutreachBusy(true)
                      try {
                        const res = await fetch(apiUrl('/api/outreach/send-email'), {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            leadId,
                            sequenceKey,
                            stepIndex: emailStepIndex,
                            body: emailDraft,
                            emailOverride: emailToInput.trim() || undefined,
                          }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error((data as { error?: string }).error || 'Отправка не удалась')
                        toast('Письмо отправлено (Resend)', 'success')
                        refreshOutreachLogs(leadId)
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Ошибка Resend', 'error')
                      } finally {
                        setOutreachBusy(false)
                      }
                    }}
                    className="flex-1 min-w-[140px] rounded-xl bg-indigo-600 py-2.5 text-center text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Resend API
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!emailDraft.trim()}
                  onClick={async () => {
                    try {
                      const res = await fetch(apiUrl('/api/outreach/log'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          leadId,
                          channel: 'email',
                          direction: 'outbound',
                          body: emailDraft,
                          status: 'sent',
                        }),
                      })
                      if (!res.ok) throw new Error('Запись не удалась')
                      toast('Письмо записано в журнал', 'success')
                      refreshOutreachLogs(leadId)
                    } catch {
                      toast('Не удалось записать', 'error')
                    }
                  }}
                  className="flex-1 min-w-[100px] rounded-xl border border-sky-500/30 bg-sky-500/10 py-2.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/15 disabled:opacity-40"
                >
                  В журнал
                </button>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {emailApiSend
                  ? 'Можно отправить через Resend (API) или открыть черновик в почтовом клиенте. Журнал фиксирует факт касания.'
                  : 'Отправка из приложения через Resend не настроена (RESEND_API_KEY) — откройте письмо в клиенте или скопируйте текст.'}
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
