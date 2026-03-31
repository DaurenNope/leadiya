import { useCallback, useEffect, useState } from 'react'
import { apiUrl, authFetch } from '../apiBase'
import { useToast } from '../hooks/useToast'

type ScriptSummary = {
  key: string
  trigger: string
  steps: { id: string; channel: string; delay?: string | number }[]
  isOverridden?: boolean
}

type ScriptStep = {
  id: string
  channel: 'whatsapp' | 'email'
  template: string
  delay?: string | number
  condition?: string
}

type ScriptDetail = {
  key: string
  trigger: string
  steps: ScriptStep[]
  isOverridden: boolean
}

const VAR_HINTS = ['company', 'first_name', 'city', 'industry', 'calendar_url', 'signature', 'our_name', 'product_name']

async function readJsonError(res: Response, statusPrefix: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string }
    if (typeof j.error === 'string' && j.error.trim()) return `${statusPrefix}: ${j.error}`
  } catch {
    /* not JSON */
  }
  return statusPrefix
}

export function OutreachScriptsView() {
  const { toast } = useToast()
  const [list, setList] = useState<ScriptSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [tenantBlocked, setTenantBlocked] = useState(false)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<ScriptDetail | null>(null)
  const [draftTrigger, setDraftTrigger] = useState('')
  const [draftSteps, setDraftSteps] = useState<ScriptStep[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [previewLeadId, setPreviewLeadId] = useState('')
  const [previewStepIndex, setPreviewStepIndex] = useState(0)
  const [previewBody, setPreviewBody] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    setTenantBlocked(false)
    try {
      const res = await authFetch(apiUrl('/api/outreach/scripts'))
      if (res.status === 403) {
        setTenantBlocked(true)
        setList([])
        return
      }
      if (!res.ok) {
        setListError(await readJsonError(res, `HTTP ${res.status}`))
        setList([])
        return
      }
      const data = (await res.json()) as { sequences?: ScriptSummary[] }
      setList(data.sequences ?? [])
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Ошибка загрузки')
      setList([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (listLoading || tenantBlocked || list.length === 0) return
    setSelectedKey((k) => {
      if (k && list.some((s) => s.key === k)) return k
      return list[0]!.key
    })
  }, [listLoading, tenantBlocked, list])

  const loadDetail = useCallback(async (key: string) => {
    setDetailLoading(true)
    setDetail(null)
    setPreviewBody(null)
    try {
      const res = await authFetch(apiUrl(`/api/outreach/scripts/${encodeURIComponent(key)}`))
      if (res.status === 403) {
        setTenantBlocked(true)
        return
      }
      if (!res.ok) {
        toast(await readJsonError(res, `Не удалось загрузить цепочку (HTTP ${res.status})`), 'error')
        return
      }
      const data = (await res.json()) as ScriptDetail
      setDetail(data)
      setDraftTrigger(data.trigger)
      setDraftSteps(
        data.steps.map((s) => ({
          id: s.id,
          channel: s.channel === 'email' ? 'email' : 'whatsapp',
          template: s.template,
          delay: s.delay,
          condition: s.condition,
        })),
      )
      setPreviewStepIndex(0)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (selectedKey) void loadDetail(selectedKey)
  }, [selectedKey, loadDetail])

  const updateStep = (index: number, patch: Partial<ScriptStep>) => {
    setDraftSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const addStep = () => {
    setDraftSteps((prev) => [
      ...prev,
      {
        id: `step_${prev.length + 1}`,
        channel: 'whatsapp',
        template: '',
        delay: '1d',
      },
    ])
  }

  const removeStep = (index: number) => {
    setDraftSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  const save = async () => {
    if (!selectedKey) return
    for (let i = 0; i < draftSteps.length; i++) {
      const s = draftSteps[i]!
      if (!s.id.trim() || !s.template.trim()) {
        toast(`Шаг ${i + 1}: заполните id и текст`, 'error')
        return
      }
    }
    setSaving(true)
    try {
      const res = await authFetch(apiUrl(`/api/outreach/scripts/${encodeURIComponent(selectedKey)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger: draftTrigger.trim() || 'custom',
          steps: draftSteps.map((s) => ({
            id: s.id.trim(),
            channel: s.channel,
            template: s.template,
            ...(s.delay !== undefined && s.delay !== '' ? { delay: s.delay } : {}),
            ...(s.condition?.trim() ? { condition: s.condition.trim() } : {}),
          })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 403) {
        setTenantBlocked(true)
        return
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast('Скрипт сохранён', 'success')
      await loadList()
      await loadDetail(selectedKey)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не сохранилось', 'error')
    } finally {
      setSaving(false)
    }
  }

  const resetToDefault = async () => {
    if (!selectedKey) return
    if (!window.confirm(`Сбросить «${selectedKey}» к шаблону из репозитория?`)) return
    setSaving(true)
    try {
      const res = await authFetch(apiUrl(`/api/outreach/scripts/${encodeURIComponent(selectedKey)}`), {
        method: 'DELETE',
      })
      if (res.status === 403) {
        setTenantBlocked(true)
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast('Сброшено к умолчанию', 'success')
      await loadList()
      await loadDetail(selectedKey)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    } finally {
      setSaving(false)
    }
  }

  const runPreview = async () => {
    const leadId = previewLeadId.trim()
    if (!leadId || !selectedKey) {
      toast('Укажите UUID лида', 'info')
      return
    }
    setPreviewBusy(true)
    setPreviewBody(null)
    try {
      const res = await authFetch(apiUrl('/api/outreach/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          sequenceKey: selectedKey,
          stepIndex: previewStepIndex,
        }),
      })
      const data = (await res.json()) as { error?: string; body?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setPreviewBody(data.body ?? '')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Предпросмотр не удался', 'error')
    } finally {
      setPreviewBusy(false)
    }
  }

  const inputCls =
    'rounded-xl border border-white/[0.1] bg-slate-900/80 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500/35'
  const labelCls = 'text-[11px] font-semibold uppercase tracking-wide text-slate-500'

  if (tenantBlocked) {
    return (
      <div className="max-w-2xl rounded-2xl border border-amber-500/25 bg-amber-950/20 px-6 py-5 text-sm text-amber-100/90">
        <p className="font-semibold text-amber-200">Нужна организация (tenant)</p>
        <p className="mt-2 text-amber-100/80 leading-relaxed">
          Редактирование скриптов доступно только при привязанном tenant в Supabase. Проверьте вход и наличие строки в таблице{' '}
          <code className="text-amber-200/90">tenants</code> для вашего пользователя.
        </p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in max-w-6xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Outreach</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Переопределения хранятся в БД на организацию; дефолты — из <code className="text-slate-400">sequences.yml</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadList()}
          className="rounded-xl border border-white/[0.1] bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/[0.04]"
        >
          Обновить список
        </button>
      </div>

      {listError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-100/95 whitespace-pre-wrap break-words leading-relaxed"
        >
          {listError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,280px)_1fr] gap-6 items-start">
        <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Цепочки
          </div>
          <div className="max-h-[min(70vh,520px)] overflow-y-auto">
            {listLoading ? (
              <p className="p-4 text-sm text-slate-500">Загрузка…</p>
            ) : list.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Нет цепочек</p>
            ) : (
              <ul>
                {list.map((s) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(s.key)}
                      className={`w-full text-left px-4 py-3 text-sm border-b border-white/[0.04] transition-colors ${
                        selectedKey === s.key
                          ? 'bg-violet-500/15 text-violet-100 ring-1 ring-inset ring-violet-500/25'
                          : 'text-slate-300 hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="font-mono text-xs text-violet-300/90">{s.key}</span>
                      {s.isOverridden && (
                        <span className="ml-2 text-[10px] font-bold uppercase text-amber-400/90">override</span>
                      )}
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">{s.trigger}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          {!selectedKey && (
            <p className="text-sm text-slate-500">Выберите цепочку слева.</p>
          )}

          {selectedKey && detailLoading && <p className="text-sm text-slate-500">Загрузка редактора…</p>}

          {selectedKey && !detailLoading && (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  disabled={saving || !detail?.isOverridden}
                  onClick={() => void resetToDefault()}
                  className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm text-slate-300 hover:bg-white/[0.04] disabled:opacity-40"
                  title={detail?.isOverridden ? undefined : 'Нет переопределения в БД'}
                >
                  Сбросить к умолчанию
                </button>
              </div>

              <div className="space-y-2">
                <label className={labelCls}>Триггер (trigger)</label>
                <input
                  className={`w-full ${inputCls}`}
                  value={draftTrigger}
                  onChange={(e) => setDraftTrigger(e.target.value)}
                  placeholder="qualified_lead"
                />
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-slate-900/30 p-4">
                <p className={`${labelCls} mb-2`}>Подсказка по переменным</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  В тексте шагов используйте <code className="text-slate-400">{'{{переменная}}'}</code>, например:{' '}
                  {VAR_HINTS.map((v) => (
                    <code key={v} className="text-violet-300/80 mr-1">
                      {`{{${v}}}`}
                    </code>
                  ))}
                </p>
              </div>

              <div className="space-y-4">
                {draftSteps.map((step, i) => (
                  <div
                    key={`${step.id}-${i}`}
                    className="rounded-2xl border border-white/[0.08] bg-slate-950/40 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-400">Шаг {i + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        disabled={draftSteps.length <= 1}
                        className="text-[11px] text-rose-400/80 hover:text-rose-300 disabled:opacity-30"
                      >
                        Удалить шаг
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>id</label>
                        <input
                          className={`w-full mt-1 ${inputCls}`}
                          value={step.id}
                          onChange={(e) => updateStep(i, { id: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Канал</label>
                        <select
                          className={`w-full mt-1 ${inputCls}`}
                          value={step.channel}
                          onChange={(e) =>
                            updateStep(i, { channel: e.target.value === 'email' ? 'email' : 'whatsapp' })
                          }
                        >
                          <option value="whatsapp">WhatsApp</option>
                          <option value="email">Email</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Задержка (delay)</label>
                        <input
                          className={`w-full mt-1 ${inputCls}`}
                          value={step.delay === undefined ? '' : String(step.delay)}
                          onChange={(e) => {
                            const v = e.target.value
                            if (!v) updateStep(i, { delay: undefined })
                            else if (/^\d+$/.test(v)) updateStep(i, { delay: parseInt(v, 10) })
                            else updateStep(i, { delay: v })
                          }}
                          placeholder="0, 3d, 1h"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Условие (condition)</label>
                        <input
                          className={`w-full mt-1 ${inputCls}`}
                          value={step.condition ?? ''}
                          onChange={(e) => updateStep(i, { condition: e.target.value || undefined })}
                          placeholder="no_response"
                        />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Текст шаблона</label>
                      <textarea
                        className={`w-full mt-1 min-h-[140px] resize-y font-mono text-[13px] leading-relaxed ${inputCls}`}
                        value={step.template}
                        onChange={(e) => updateStep(i, { template: e.target.value })}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addStep}
                  className="text-sm text-violet-400/90 hover:text-violet-300 font-medium"
                >
                  + Добавить шаг
                </button>
              </div>

              <div className="rounded-2xl border border-sky-500/20 bg-sky-950/20 p-5 space-y-3">
                <h3 className="text-sm font-semibold text-sky-200">Предпросмотр</h3>
                <p className="text-[11px] text-slate-500">
                  Подставит переменные для лида через <code className="text-slate-400">POST /api/outreach/preview</code>.
                </p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className={labelCls}>UUID лида</label>
                    <input
                      className={`w-full mt-1 ${inputCls}`}
                      value={previewLeadId}
                      onChange={(e) => setPreviewLeadId(e.target.value)}
                      placeholder="00000000-0000-0000-0000-000000000000"
                    />
                  </div>
                  <div className="w-24">
                    <label className={labelCls}>Шаг #</label>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, draftSteps.length - 1)}
                      className={`w-full mt-1 ${inputCls}`}
                      value={previewStepIndex}
                      onChange={(e) => setPreviewStepIndex(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={previewBusy}
                    onClick={() => void runPreview()}
                    className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                  >
                    {previewBusy ? '…' : 'Показать'}
                  </button>
                </div>
                {previewBody != null && (
                  <pre className="rounded-xl border border-white/[0.08] bg-slate-950/80 p-4 text-sm text-slate-200 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                    {previewBody}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
