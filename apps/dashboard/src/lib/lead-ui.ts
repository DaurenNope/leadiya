type LeadStatusOpts = {
  /** `new` — как в таблице (пусто = новый лид). `dash` — как в карточке (пусто = «—»). */
  whenEmpty?: 'new' | 'dash'
}

/** Человекочитаемый статус воронки (значения из API часто на английском). */
export function leadStatusLabel(status: string | null | undefined, opts?: LeadStatusOpts): string {
  const whenEmpty = opts?.whenEmpty ?? 'new'
  if (status == null || !String(status).trim()) {
    return whenEmpty === 'dash' ? '—' : 'новый'
  }
  const s = status.toLowerCase()
  const map: Record<string, string> = {
    new: 'новый',
    valid: 'проверен',
    enriched: 'обогащён',
    failed: 'сбой',
    archived: 'архив',
  }
  return map[s] ?? status.trim()
}
