export function splitEmailTemplate(text: string): { subject: string; body: string } {
  const t = text.trim()
  const lines = t.split('\n')
  const first = lines[0] ?? ''
  const m = first.match(/^Тема:\s*(.+)$/i)
  if (m) {
    const rest = lines.slice(1).join('\n').trim()
    return { subject: m[1].trim().slice(0, 240), body: rest || t }
  }
  return { subject: 'Сообщение', body: t }
}

export function buildMailtoUrl(to: string, body: string, subject: string): string {
  const clean = to.trim()
  if (!clean) return ''
  const p = new URLSearchParams()
  p.set('subject', subject.slice(0, 500))
  p.set('body', body.slice(0, 8000))
  return `mailto:${encodeURIComponent(clean)}?${p.toString()}`
}
