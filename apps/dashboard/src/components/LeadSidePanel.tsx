import { useEffect, useState } from 'react'
import type { Lead } from '../types'
import { useToast } from '../hooks/useToast'

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
      title="Copy to clipboard"
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

type OutreachLogRow = {
  id: string
  channel: string
  direction: string
  body: string | null
  status: string | null
  createdAt: string
}

export function LeadSidePanel({ lead: initialLead, onClose }: Props) {
  const { toast } = useToast()
  const [lead, setLead] = useState<Lead | null>(initialLead)
  const [loading, setLoading] = useState(!!initialLead)
  const [crmOpen, setCrmOpen] = useState(false)
  const [sequenceKeys, setSequenceKeys] = useState<string[]>([])
  const [sequenceKey, setSequenceKey] = useState('cold_outreach')
  const [draftBody, setDraftBody] = useState('')
  const [waLink, setWaLink] = useState<string | null>(null)
  const [phoneDigits, setPhoneDigits] = useState<string | null>(null)
  const [baileysSend, setBaileysSend] = useState(false)
  const [outreachBusy, setOutreachBusy] = useState(false)
  const [outreachLogs, setOutreachLogs] = useState<OutreachLogRow[]>([])

  useEffect(() => {
    if (!initialLead) return
    let cancelled = false
    fetch(`/api/companies/${initialLead.id}`)
      .then(res => res.json())
      .then(data => { if (!cancelled) setLead(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [initialLead])

  useEffect(() => {
    fetch('/api/outreach/sequences')
      .then((r) => (r.ok ? r.json() : { sequences: [] }))
      .then((d: { sequences?: { key: string }[] }) => {
        const keys = (d.sequences ?? []).map((s) => s.key)
        if (keys.length) setSequenceKeys(keys)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/outreach/business')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { whatsapp_baileys_send?: boolean }) => setBaileysSend(!!d.whatsapp_baileys_send))
      .catch(() => setBaileysSend(false))
  }, [])

  useEffect(() => {
    setPhoneDigits(null)
    setWaLink(null)
    setDraftBody('')
  }, [initialLead?.id])

  const refreshOutreachLogs = (leadId: string) => {
    fetch(`/api/outreach/log?leadId=${encodeURIComponent(leadId)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: OutreachLogRow[] }) => setOutreachLogs(d.items ?? []))
      .catch(() => setOutreachLogs([]))
  }

  const isOpen = !!initialLead
  const displayLead = lead || initialLead

  useEffect(() => {
    const id = displayLead?.id
    if (!id) return
    refreshOutreachLogs(id)
  }, [displayLead?.id])

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
          <div className="side-panel-content flex flex-col h-full">
            {/* Header */}
            <div className="mb-10 flex items-start justify-between">
              <div className="flex gap-6 items-center">
                <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center text-2xl font-black text-brand-400 border border-brand-500/20 shadow-inner">
                  {displayLead.name?.[0] || '?'}
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-black text-white leading-tight">{displayLead.name}</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{displayLead.city}</span>
                    <div className="w-1 h-1 rounded-full bg-slate-700"></div>
                    <span className="text-[10px] font-black text-brand-500 uppercase tracking-widest">{displayLead.status}</span>
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

            <div className="flex-1 space-y-10">
              {/* Intelligence Section */}
              <div className="space-y-6">
                <div>
                  <h3 className="workspace-label">Legal Identity</h3>
                  <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 space-y-4">
                    <div className="flex justify-between items-center group/field">
                      <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">BIN</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-slate-200 font-bold">{displayLead.bin || 'N/A'}</span>
                        <CopyButton value={displayLead.bin} />
                      </div>
                    </div>
                    <div className="flex justify-between items-start gap-4 group/field">
                      <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest shrink-0">Vertical</span>
                      <span className="text-[11px] text-slate-300 font-bold text-right">{displayLead.category || 'Unclassified'}</span>
                    </div>
                    {displayLead.legalStatus && (
                      <div className="flex justify-between items-center group/field">
                        <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Status</span>
                        <span className="text-[10px] text-brand-400 font-black uppercase">{displayLead.legalStatus}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="workspace-label">Market Signals (2GIS)</h3>
                  <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">Rating</span>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-amber-500">{displayLead.rating2gis || '0.0'}</span>
                        <div className="flex gap-0.5">
                           {[1,2,3,4,5].map(i => (
                             <div key={i} className={`w-1 h-1 rounded-full ${i <= Math.round(Number(displayLead.rating2gis || 0)) ? 'bg-amber-500' : 'bg-slate-800'}`}></div>
                           ))}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">Reviews</span>
                      <div className="text-2xl font-black text-slate-200">{displayLead.reviewsCount2gis || 0}</div>
                    </div>
                  </div>
                </div>

                {displayLead.enrichmentSources && Object.keys(displayLead.enrichmentSources).length > 0 && (
                <div>
                  <h3 className="workspace-label">Enrichment Status</h3>
                  <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 space-y-3">
                    {Object.entries(displayLead.enrichmentSources).map(([source, info]) => {
                      const st = (info as { status?: string })?.status ?? '—'
                      return (
                      <div key={source} className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{source}</span>
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                          st === 'ok'
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                        }`}>{st}</span>
                      </div>
                    )})}
                  </div>
                </div>
              )}

              {displayLead.openingHours && (
                  <div>
                    <h3 className="workspace-label">Operational Hours</h3>
                    <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 space-y-2">
                       {/* Simplified display for now */}
                       <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                         <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                         Schedule Active
                       </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Outreach Section */}
              <div className="space-y-6">
                <div>
                   <h3 className="workspace-label">Digital Presence</h3>
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
                  <h3 className="workspace-label">Direct Contacts</h3>
                  <div className="space-y-3">
                    {loading ? (
                      <div className="p-8 border border-white/5 border-dashed rounded-[2rem] animate-pulse text-center">
                        <span className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em]">Intercepting Contact Waves...</span>
                      </div>
                    ) : (
                      <>
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
                              <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{contact.fullName || 'Verified Signal'}</span>
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
                              <span className="text-[8px] font-bold text-slate-600 uppercase">No phone</span>
                            )}
                          </div>
                        )})}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Spatial Intelligence */}
              {displayLead.lat && displayLead.lng && (
                <div>
                  <h3 className="workspace-label">Spatial Intelligence</h3>
                  <div className="bg-slate-950/40 rounded-3xl p-6 border border-white/5 flex items-center justify-between">
                     <div className="flex flex-col gap-1">
                       <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">Coordinates</span>
                       <span className="text-[10px] font-mono text-slate-400 font-bold">{displayLead.lat}, {displayLead.lng}</span>
                     </div>
                     <button className="p-3 bg-slate-900 rounded-2xl border border-white/5 text-slate-400 hover:text-brand-400 transition-all">
                       <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                     </button>
                  </div>
                </div>
              )}
            </div>

            {crmOpen && displayLead && (
              <div className="mt-8 space-y-4 rounded-3xl border border-brand-500/20 bg-brand-500/5 p-6">
                <h3 className="workspace-label">Outreach (YAML sequences + WhatsApp)</h3>
                <p className="text-[9px] text-slate-500 leading-relaxed">
                  Renders <code className="text-slate-400">apps/api/config/sequences.yml</code> with variables from the lead and{' '}
                  <code className="text-slate-400">business.yml</code>. Use <code className="text-slate-400">wa.me</code> or, when enabled on the API, queue a send via Baileys workers.
                </p>
                <div className="flex flex-col gap-2">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Sequence</label>
                  <select
                    value={sequenceKey}
                    onChange={(e) => setSequenceKey(e.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-slate-200"
                  >
                    {(sequenceKeys.length ? sequenceKeys : ['cold_outreach']).map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={outreachBusy}
                  onClick={async () => {
                    if (!displayLead.id) return
                    setOutreachBusy(true)
                    try {
                      const res = await fetch('/api/outreach/preview', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ leadId: displayLead.id, sequenceKey, stepIndex: 0 }),
                      })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error || 'Preview failed')
                      setDraftBody(data.body || '')
                      setWaLink(data.waLink || null)
                      setPhoneDigits((data as { phoneDigits?: string | null }).phoneDigits ?? null)
                      if (!data.waLink && data.channel === 'whatsapp') {
                        toast('No WhatsApp number on lead — add phone or wa.me link', 'info')
                      }
                    } catch (e) {
                      toast(e instanceof Error ? e.message : 'Preview failed', 'error')
                    } finally {
                      setOutreachBusy(false)
                    }
                  }}
                  className="w-full rounded-xl bg-slate-800 py-3 text-[10px] font-black uppercase tracking-widest text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  Build first-step message
                </button>
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={8}
                  className="w-full resize-y rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-200 placeholder:text-slate-600"
                  placeholder="Message body…"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(draftBody)
                      toast('Copied', 'success')
                    }}
                    className="flex-1 min-w-[100px] rounded-xl border border-white/10 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:border-brand-500/40"
                  >
                    Copy
                  </button>
                  {waLink ? (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 min-w-[120px] rounded-xl bg-emerald-600 py-2.5 text-center text-[9px] font-black uppercase tracking-widest text-white hover:bg-emerald-500"
                    >
                      Open WhatsApp
                    </a>
                  ) : null}
                  {baileysSend && phoneDigits && draftBody.trim() ? (
                    <button
                      type="button"
                      disabled={outreachBusy}
                      onClick={async () => {
                        if (!displayLead?.id) return
                        setOutreachBusy(true)
                        try {
                          const res = await fetch('/api/outreach/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              leadId: displayLead.id,
                              sequenceKey,
                              stepIndex: 0,
                              body: draftBody,
                            }),
                          })
                          const data = await res.json()
                          if (!res.ok) throw new Error((data as { error?: string }).error || 'Queue failed')
                          toast('Message queued for WhatsApp (Baileys)', 'success')
                          refreshOutreachLogs(displayLead.id)
                        } catch (e) {
                          toast(e instanceof Error ? e.message : 'Queue failed', 'error')
                        } finally {
                          setOutreachBusy(false)
                        }
                      }}
                      className="flex-1 min-w-[120px] rounded-xl bg-violet-600 py-2.5 text-center text-[9px] font-black uppercase tracking-widest text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      Queue WhatsApp send
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!draftBody.trim()}
                    onClick={async () => {
                      if (!displayLead.id) return
                      try {
                        const res = await fetch('/api/outreach/log', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            leadId: displayLead.id,
                            channel: 'whatsapp',
                            direction: 'outbound',
                            body: draftBody,
                            status: 'sent',
                          }),
                        })
                        if (!res.ok) throw new Error('Log failed')
                        toast('Logged as sent', 'success')
                        refreshOutreachLogs(displayLead.id)
                      } catch {
                        toast('Could not log touchpoint', 'error')
                      }
                    }}
                    className="flex-1 min-w-[100px] rounded-xl bg-brand-500/20 py-2.5 text-[9px] font-black uppercase tracking-widest text-brand-300 hover:bg-brand-500/30 disabled:opacity-40"
                  >
                    Log sent
                  </button>
                </div>
                {outreachLogs.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">History</span>
                    <ul className="max-h-32 space-y-2 overflow-y-auto text-[10px] text-slate-400">
                      {outreachLogs.map((row) => (
                        <li key={row.id} className="rounded-lg border border-white/5 bg-slate-950/40 px-2 py-1.5">
                          <span className="font-bold text-slate-300">{row.channel}</span>{' '}
                          <span className="text-slate-600">{row.status}</span>{' '}
                          <span className="text-slate-600">
                            {row.createdAt ? new Date(row.createdAt).toLocaleString() : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-auto pt-10 border-t border-white/5 flex gap-4">
               <button className="flex-1 py-4 bg-slate-900 border border-white/5 rounded-2xl text-[10px] font-black text-slate-400 hover:text-white hover:bg-slate-800 transition-all uppercase tracking-widest">
                 Archive Entity
               </button>
               <button
                 type="button"
                 onClick={() => setCrmOpen((v) => !v)}
                 className={`flex-[2] py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl transition-all ${
                   crmOpen
                     ? 'bg-slate-800 text-slate-200 border border-white/10'
                     : 'bg-brand-500 text-white shadow-brand-500/40 hover:bg-brand-600'
                 }`}
               >
                 {crmOpen ? 'Close outreach' : 'Launch outreach'}
               </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
