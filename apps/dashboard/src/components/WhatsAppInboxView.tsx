import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl, authFetch } from '../apiBase'
import { useToast } from '../hooks/useToast'

type WaStatus = { status: string; updatedAt: number | null; qr: string | null; baileysSendEnabled: boolean }

type WaLogRow = {
  id: string
  leadId: string | null
  channel: string
  direction: string
  body: string | null
  status: string | null
  createdAt: string
  waPeer?: string | null
  leadName?: string | null
  leadCity?: string | null
}

type Props = {
  /** Open this thread after navigate from CRM (matched when log has this lead or phone). */
  focusRequest?: { leadId?: string; phoneDigits?: string } | null
  onFocusConsumed?: () => void
  onWorkLead: (leadId: string) => void
  onBrowseLeads: () => void
  onOpenCrm?: () => void
  onOpenSettings?: () => void
}

type Conversation = {
  /** Stable list key + merge tracking */
  threadKey: string
  /** Best JID for API + sending (prefer @s.whatsapp.net over @lid) */
  peer: string
  leadId: string | null
  leadName: string | null
  leadCity: string | null
  messages: WaLogRow[]
  lastMessage: WaLogRow
  hasUnread: boolean
}

function extractPhone(jid: string): string {
  return jid.replace(/@.*$/, '').replace(/\D/g, '')
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatShortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'вчера'
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short' })
}

function initials(name: string | null | undefined, peer: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }
  const digits = extractPhone(peer)
  return digits.slice(-2) || '??'
}

function pickBestWaPeer(messages: WaLogRow[]): string {
  const jids = messages.map((m) => m.waPeer?.trim()).filter(Boolean) as string[]
  const s = jids.find((j) => j.includes('@s.whatsapp.net'))
  return s ?? jids[0] ?? ''
}

/** Group rows: CRM lead id wins; else last 10 digits (merges @lid vs @s.whatsapp.net for same phone). */
function rowThreadKey(row: WaLogRow): string {
  if (row.leadId) return `l:${row.leadId}`
  const jid = row.waPeer?.trim()
  if (!jid) return `u:${row.id}`
  const digits = jid.replace(/\D/g, '')
  if (digits.length >= 10) return `d:${digits.slice(-10)}`
  return `j:${jid}`
}

function dedupeMergeMessages(a: WaLogRow[], b: WaLogRow[]): WaLogRow[] {
  const seen = new Set<string>()
  const out: WaLogRow[] = []
  for (const m of [...a, ...b]) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out.sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime())
}

/**
 * Same contact often appears twice: rows with lead_id vs rows matched only by JID (@lid ≠ @s.whatsapp.net).
 * Merge digit-only threads into lead threads when phone (last 10) matches any message wa_peer in that lead.
 */
/**
 * Merge sidebar rows that share the same phone (last 10 digits) but different lead_id / JID forms
 * (e.g. two CRM leads for one number, or l:… vs d:… buckets).
 */
function mergeConversationsByPhoneDigits(conversations: Conversation[]): Conversation[] {
  const byLast10 = new Map<string, Conversation[]>()
  const orphans: Conversation[] = []

  for (const c of conversations) {
    const last10 = extractPhone(c.peer).slice(-10)
    if (last10.length === 10) {
      const arr = byLast10.get(last10) ?? []
      arr.push(c)
      byLast10.set(last10, arr)
    } else {
      orphans.push(c)
    }
  }

  const merged: Conversation[] = []
  for (const [, group] of byLast10) {
    if (group.length === 1) {
      merged.push(group[0]!)
      continue
    }
    let acc = group[0]!
    for (let i = 1; i < group.length; i++) {
      acc = mergeTwoConversations(acc, group[i]!)
    }
    merged.push(acc)
  }

  return [...merged, ...orphans].sort(
    (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
  )
}

function mergeTwoConversations(a: Conversation, b: Conversation): Conversation {
  const messages = dedupeMergeMessages(a.messages, b.messages)
  let leadId = pickPreferredLeadId(a, b)
  const fromRows = [...messages].reverse().find((m) => m.leadId)?.leadId ?? null
  if (!leadId && fromRows) leadId = fromRows
  const leadName = a.leadName ?? b.leadName
  const leadCity = a.leadCity ?? b.leadCity
  const peer = pickBestWaPeer(messages)
  const lastMessage = messages[messages.length - 1]!
  const lastOutIdx = messages.findLastIndex((m) => m.direction === 'outbound')
  const hasUnread = messages.some((m, i) => m.direction === 'inbound' && i > lastOutIdx)
  const threadKey = leadId ? `l:${leadId}` : rowThreadKey(lastMessage)
  return { threadKey, peer, leadId, leadName, leadCity, messages, lastMessage, hasUnread }
}

function pickPreferredLeadId(a: Conversation, b: Conversation): string | null {
  if (a.leadId && !b.leadId) return a.leadId
  if (!a.leadId && b.leadId) return b.leadId
  if (a.leadName && !b.leadName) return a.leadId
  if (!a.leadName && b.leadName) return b.leadId
  return a.leadId ?? b.leadId
}

function mergeLeadAndDigitThreads(conversations: Conversation[]): Conversation[] {
  const byLead = new Map<string, Conversation>()
  const digitOnly: Conversation[] = []

  for (const c of conversations) {
    if (c.leadId) {
      const ex = byLead.get(c.leadId)
      if (!ex) {
        byLead.set(c.leadId, { ...c, messages: [...c.messages] })
      } else {
        ex.messages = dedupeMergeMessages(ex.messages, c.messages)
        ex.lastMessage = ex.messages[ex.messages.length - 1]!
        ex.peer = pickBestWaPeer(ex.messages)
        ex.hasUnread = ex.hasUnread || c.hasUnread
        ex.leadName = ex.leadName ?? c.leadName
        ex.leadCity = ex.leadCity ?? c.leadCity
      }
    } else {
      digitOnly.push(c)
    }
  }

  const absorbedKeys = new Set<string>()
  for (const c of digitOnly) {
    const last10 = extractPhone(c.peer).slice(-10)
    if (last10.length < 10) continue
    let hitLead: string | undefined
    for (const [leadId, lc] of byLead) {
      const match = lc.messages.some((m) => {
        const w = m.waPeer?.replace(/\D/g, '') ?? ''
        return w.length >= 10 && w.slice(-10) === last10
      })
      if (match) {
        hitLead = leadId
        break
      }
    }
    if (hitLead) {
      const target = byLead.get(hitLead)!
      target.messages = dedupeMergeMessages(target.messages, c.messages)
      target.lastMessage = target.messages[target.messages.length - 1]!
      target.peer = pickBestWaPeer(target.messages)
      target.hasUnread = target.hasUnread || c.hasUnread
      absorbedKeys.add(c.threadKey)
    }
  }

  const rest = digitOnly.filter((c) => !absorbedKeys.has(c.threadKey))
  return [...byLead.values(), ...rest].sort(
    (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
  )
}

function groupByConversation(items: WaLogRow[]): Conversation[] {
  const map = new Map<string, WaLogRow[]>()
  for (const row of items) {
    const key = rowThreadKey(row)
    const existing = map.get(key) || []
    existing.push(row)
    map.set(key, existing)
  }
  const conversations = Array.from(map.entries()).map(([threadKey, messages]) => {
    const sorted = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    const lastMessage = sorted[sorted.length - 1]!
    const lastOutIdx = sorted.findLastIndex((m) => m.direction === 'outbound')
    const hasUnread = sorted.some((m, i) => m.direction === 'inbound' && i > lastOutIdx)
    const leadName = sorted.findLast((m) => m.leadName)?.leadName ?? null
    const leadCity = sorted.findLast((m) => m.leadCity)?.leadCity ?? null
    const leadId = sorted.findLast((m) => m.leadId)?.leadId ?? null
    const peer = pickBestWaPeer(sorted)
    return { threadKey, peer, leadId, leadName, leadCity, messages: sorted, lastMessage, hasUnread }
  })
  return mergeConversationsByPhoneDigits(mergeLeadAndDigitThreads(conversations))
}

const WA_STATUS_POLL_MS = 10_000

export function WhatsAppInboxView({
  focusRequest = null,
  onFocusConsumed,
  onWorkLead,
  onBrowseLeads,
  onOpenCrm,
  onOpenSettings,
}: Props) {
  const { toast } = useToast()
  const [items, setItems] = useState<WaLogRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [waStatus, setWaStatus] = useState<WaStatus | null>(null)
  /** Stable id for sidebar + selection (peer JID can change after merge). */
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null)
  const selectedPhoneSuffixRef = useRef<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const [mobileShowThread, setMobileShowThread] = useState(false)
  /** Full message list for the open thread (GET /log?waPeer=…); global feed alone truncates each chat. */
  const [threadMessages, setThreadMessages] = useState<WaLogRow[] | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  /** When false, inbound rows are not written — dashboard shows outbounds only. */
  const [inboundLogEnabled] = useState(true)
  /** Only show spinner when switching chats — not on every global log poll (`items` refresh). */
  const threadPeerKeyRef = useRef<string>('')

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setLoading(true)
    try {
      /** Global feed only — each thread’s full history is loaded separately when you open it. */
      const res = await authFetch(apiUrl('/api/outreach/log?channel=whatsapp&limit=200'))
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        setItems([])
        setWarning(null)
        return
      }
      setError(null)
      const data = (await res.json()) as { items?: WaLogRow[]; warning?: string }
      setItems(data.items ?? [])
      setWarning(typeof data.warning === 'string' ? data.warning : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить')
      setItems([])
      setWarning(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const conversations = groupByConversation(items)
  const activeConvo = activeThreadKey
    ? conversations.find((c) => c.threadKey === activeThreadKey) ?? null
    : null
  const activeLeadId = activeConvo?.leadId ?? null
  const activePeer = activeConvo?.peer ?? null

  /** After poll/merge, threadKey can change — keep selection on same phone. */
  useEffect(() => {
    if (!activeThreadKey) return
    if (conversations.some((c) => c.threadKey === activeThreadKey)) return
    const suffix = selectedPhoneSuffixRef.current
    if (suffix && suffix.length === 10) {
      const next = conversations.find((c) => extractPhone(c.peer).slice(-10) === suffix)
      if (next) setActiveThreadKey(next.threadKey)
    }
  }, [conversations, activeThreadKey])

  const fetchWaStatus = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/outreach/whatsapp/status'))
      if (!res.ok) return
      const data = (await res.json()) as WaStatus
      setWaStatus(data)
    } catch {
      /* keep last known */
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!activePeer) {
      setThreadMessages(null)
      setThreadLoading(false)
      threadPeerKeyRef.current = ''
      return
    }
    const peerKey = `${activePeer}\0${activeLeadId ?? ''}`
    const peerSwitched = threadPeerKeyRef.current !== peerKey
    threadPeerKeyRef.current = peerKey
    if (peerSwitched) setThreadLoading(true)

    let cancelled = false
    const params = new URLSearchParams({
      channel: 'whatsapp',
      waPeer: activePeer,
      limit: '500',
      order: 'asc',
    })
    if (activeLeadId) params.set('leadId', activeLeadId)
    void (async () => {
      try {
        const res = await authFetch(apiUrl(`/api/outreach/log?${params}`))
        if (!res.ok) {
          if (!cancelled) setThreadMessages(null)
          return
        }
        const data = (await res.json()) as { items?: WaLogRow[] }
        if (!cancelled) setThreadMessages(data.items ?? [])
      } catch {
        if (!cancelled) setThreadMessages(null)
      } finally {
        if (!cancelled && peerSwitched) setThreadLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activePeer, activeLeadId, activeThreadKey])

  useEffect(() => {
    void fetchWaStatus()
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void fetchWaStatus()
    }, WA_STATUS_POLL_MS)
    return () => window.clearInterval(id)
  }, [fetchWaStatus])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load({ silent: true })
    }, 12_000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!focusRequest) return
    if (loading) return
    const { leadId, phoneDigits } = focusRequest
    const norm = (phoneDigits ?? '').replace(/\D/g, '')
    let peer: string | null = null
    let threadKey: string | null = null
    if (conversations.length > 0) {
      if (leadId) {
        const byLead = conversations.find((c) => c.leadId === leadId)
        if (byLead) {
          threadKey = byLead.threadKey
          peer = byLead.peer
        }
      }
      if (!threadKey && norm.length >= 10) {
        const byPhone = conversations.find((c) => {
          const d = extractPhone(c.peer)
          return d === norm || d.endsWith(norm.slice(-10)) || norm.endsWith(d.slice(-10))
        })
        if (byPhone) {
          threadKey = byPhone.threadKey
          peer = byPhone.peer
        }
      }
    }
    if (threadKey && peer) {
      setActiveThreadKey(threadKey)
      selectedPhoneSuffixRef.current = extractPhone(peer).slice(-10)
      setMobileShowThread(true)
    } else {
      toast(
        'Пока нет переписки с этим номером в ленте. Отправьте сообщение из CRM кнопкой «Отправить сейчас» (Baileys), затем откройте снова.',
        'info',
      )
    }
    onFocusConsumed?.()
  }, [focusRequest, loading, conversations, toast, onFocusConsumed])

  /** Scroll inside the thread panel only (avoid scrollIntoView moving the whole page / sticky header). */
  useEffect(() => {
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [activeThreadKey, threadMessages])

  const sendReply = useCallback(async () => {
    if (!activeConvo) return
    const phone = extractPhone(activeConvo.peer)
    const body = replyText.trim()
    if (!phone || !body || sending) return
    setSending(true)
    try {
      const res = await authFetch(apiUrl('/api/outreach/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'whatsapp', phone, body }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast('Сообщение отправлено', 'success')
      setReplyText('')
      await load({ silent: true })
      requestAnimationFrame(() => {
        const el = messagesScrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отправить', 'error')
    } finally {
      setSending(false)
    }
  }, [activeConvo, replyText, sending, load, toast])

  const selectConvo = (convo: Conversation) => {
    setActiveThreadKey(convo.threadKey)
    selectedPhoneSuffixRef.current = extractPhone(convo.peer).slice(-10)
    setMobileShowThread(true)
  }

  const wa = waStatus?.status ?? 'unknown'
  const badge =
    wa === 'connected'
      ? { dot: 'bg-emerald-400', label: 'Подключено', border: 'border-emerald-500/30 text-emerald-200/95' }
      : wa === 'waiting_qr'
        ? { dot: 'bg-amber-400', label: 'Ожидание QR', border: 'border-amber-500/35 text-amber-100/90' }
        : { dot: 'bg-red-400', label: 'Отключено', border: 'border-red-500/30 text-red-200/90' }

  return (
    <div className="animate-fade-in max-w-7xl space-y-5 flex flex-col min-h-0 max-h-[calc(100dvh-7rem)] overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">WhatsApp</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-semibold text-slate-100 tracking-tight">Лента диалогов</h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${badge.border}`}
              title={waStatus?.updatedAt != null ? `Обновлено: ${new Date(waStatus.updatedAt).toLocaleString('ru-RU')}` : undefined}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} aria-hidden />
              {badge.label}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load({ silent: false })}
            className="rounded-xl border border-white/[0.1] bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/[0.04]"
          >
            Обновить
          </button>
          {onOpenCrm && (
            <button type="button" onClick={onOpenCrm} className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-200 hover:bg-sky-500/15">
              Панель CRM
            </button>
          )}
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 hover:bg-emerald-500/15">
              Настройки WhatsApp
            </button>
          )}
          <button type="button" onClick={onBrowseLeads} className="rounded-xl border border-white/[0.1] px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200">
            Таблица лидов
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {warning && (
        <p className="text-sm text-amber-400/90 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3" role="status">
          {warning}
        </p>
      )}
      {!inboundLogEnabled && (
        <p
          className="text-sm text-rose-200/95 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 leading-relaxed"
          role="status"
        >
          Входящие сообщения <strong className="font-semibold">не пишутся в базу</strong> (отключено:
          WHATSAPP_INBOUND_LOG). В самом WhatsApp переписка полная; здесь в ленте вы увидите в основном
          исходящие. Установите WHATSAPP_INBOUND_LOG=true (или оставьте по умолчанию при Baileys) и перезапустите workers.
        </p>
      )}

      <div className="flex flex-1 flex-col min-h-0">
      {/* Two-column layout */}
      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] overflow-hidden flex flex-1 min-h-0">
        {/* Left panel — conversation list */}
        <div className={`${mobileShowThread ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 shrink-0 border-r border-white/[0.06] bg-[#070b14]/90 flex-col min-h-0`}>
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#25D366]/15 text-[#25D366]">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
              </svg>
            </span>
            <span className="text-sm font-medium text-slate-300">Диалоги</span>
            <span className="text-xs text-slate-600 ml-auto tabular-nums">{conversations.length}</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
            {loading ? (
              <p className="py-16 text-center text-sm text-slate-500">Загрузка…</p>
            ) : conversations.length === 0 ? (
              <p className="py-16 px-4 text-center text-sm text-slate-500 leading-relaxed">
                Пока пусто. Отправьте сообщение из CRM.
              </p>
            ) : (
              <ul>
                {conversations.map((convo) => {
                  const isActive = convo.threadKey === activeThreadKey
                  const displayName = convo.leadName || extractPhone(convo.peer)
                  const lastBody = convo.lastMessage.body
                  const isLastInbound = convo.lastMessage.direction === 'inbound'
                  return (
                    <li key={convo.threadKey}>
                      <button
                        type="button"
                        onClick={() => selectConvo(convo)}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                          isActive
                            ? 'bg-sky-500/12 ring-1 ring-inset ring-sky-500/25'
                            : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        {/* Avatar */}
                        <span className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold ${
                          isActive ? 'bg-sky-500/25 text-sky-300' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {initials(convo.leadName, convo.peer)}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`text-sm font-medium truncate ${convo.hasUnread ? 'text-slate-100' : 'text-slate-300'}`}>
                              {displayName}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                              {formatShortTime(convo.lastMessage.createdAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {!isLastInbound && (
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-600">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                            <p className={`text-xs truncate ${convo.hasUnread ? 'text-slate-300 font-medium' : 'text-slate-500'}`}>
                              {lastBody || 'Без текста'}
                            </p>
                          </div>
                          {convo.leadCity && (
                            <p className="text-[10px] text-slate-600 mt-0.5 truncate">{convo.leadCity}</p>
                          )}
                        </div>

                        {convo.hasUnread && (
                          <span className="shrink-0 mt-1 h-2.5 w-2.5 rounded-full bg-sky-400 shadow-lg shadow-sky-500/40" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Right panel — message thread */}
        <div className={`${mobileShowThread ? 'flex' : 'hidden lg:flex'} flex-1 flex-col min-w-0 min-h-0 bg-gradient-to-b from-[#0c1220] to-[#080c14]`}>
          {activeConvo ? (
            <>
              {/* Thread header */}
              <div className="shrink-0 px-5 py-3 border-b border-white/[0.06] bg-[#070b14]/90 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileShowThread(false)}
                  className="lg:hidden shrink-0 -ml-1 mr-1 p-1.5 rounded-lg hover:bg-white/[0.05] text-slate-400"
                  aria-label="Назад"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-400">
                  {initials(activeConvo.leadName, activeConvo.peer)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {activeConvo.leadName || extractPhone(activeConvo.peer)}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{activeConvo.peer}</p>
                </div>
                {activeConvo.leadId && (
                  <button
                    type="button"
                    onClick={() => onWorkLead(activeConvo.leadId!)}
                    className="shrink-0 rounded-lg bg-sky-600/90 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500 transition-colors"
                  >
                    Открыть в CRM
                  </button>
                )}
              </div>

              {/* Messages — threadMessages from GET /log?waPeer=… (full history); sidebar feed alone capped globally */}
              <div
                ref={messagesScrollRef}
                className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6 [scrollbar-gutter:stable]"
              >
                {threadLoading && threadMessages === null ? (
                  <p className="text-center text-sm text-slate-500 py-12">Загрузка переписки…</p>
                ) : (
                  <>
                    <ul className="space-y-3 max-w-2xl mx-auto">
                      {(threadMessages !== null ? threadMessages : activeConvo.messages).map((row) => {
                        const inbound = row.direction === 'inbound'
                        return (
                          <li key={row.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                            <div
                              className={`max-w-[min(85%,28rem)] rounded-2xl px-4 py-2.5 shadow-lg ${
                                inbound
                                  ? 'rounded-tl-md bg-slate-800/90 border border-white/[0.08] text-slate-200'
                                  : 'rounded-tr-md bg-emerald-950/80 border border-emerald-500/25 text-emerald-50'
                              }`}
                            >
                              {row.body ? (
                                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{row.body}</p>
                              ) : (
                                <p className="text-sm text-slate-500 italic">Без текста</p>
                              )}
                              <div className={`flex items-center gap-1.5 mt-1 ${inbound ? '' : 'justify-end'}`}>
                                <span className="text-[10px] tabular-nums text-slate-500">
                                  {formatTime(row.createdAt)}
                                </span>
                                {row.status && row.status !== 'logged' && (
                                  <>
                                    <span className="text-[10px] text-slate-600">·</span>
                                    <span className="text-[10px] text-slate-500">{row.status}</span>
                                  </>
                                )}
                                {!inbound && (
                                  <StatusCheck status={row.status} />
                                )}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </div>

              {/* Reply bar */}
              {wa === 'connected' && (
                <div className="shrink-0 border-t border-white/[0.08] bg-[#070b14] px-4 py-3 sm:px-6">
                  <div className="flex gap-3 max-w-2xl mx-auto">
                    <input
                      type="text"
                      placeholder="Сообщение..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void sendReply()
                        }
                      }}
                      className="flex-1 rounded-xl border border-white/10 bg-slate-900/80 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600"
                    />
                    <button
                      type="button"
                      onClick={() => void sendReply()}
                      disabled={!replyText.trim() || sending}
                      className="shrink-0 rounded-xl bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-[#05301f] hover:bg-[#20bd5a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {sending ? 'Отправка…' : 'Отправить'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1.5 max-w-2xl mx-auto leading-snug">
                    На номер {extractPhone(activeConvo.peer) || '…'} · очередь Redis и пауза между исходящими на tenant (часто ~30–90 с) — так задумано
                  </p>
                </div>
              )}
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-slate-700">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-sm">Выберите диалог слева</p>
              <p className="text-xs text-slate-600 max-w-xs text-center leading-relaxed">
                {conversations.length > 0
                  ? `${conversations.length} ${conversations.length === 1 ? 'диалог' : conversations.length < 5 ? 'диалога' : 'диалогов'} доступно`
                  : loading ? 'Загрузка…' : 'Нет диалогов — отправьте сообщение из CRM'}
              </p>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

function StatusCheck({ status }: { status: string | null }) {
  if (status === 'delivered' || status === 'read') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={status === 'read' ? 'text-sky-400' : 'text-slate-500'}>
        <polyline points="18 7 11 14 7 10" />
        <polyline points="22 7 15 14 13 12" />
      </svg>
    )
  }
  if (status === 'sent') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  return null
}
