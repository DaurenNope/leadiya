export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}

type LeadLike = {
  name?: string | null
  category?: string | null
  city?: string | null
}

export function buildOutreachVars(
  lead: LeadLike,
  business: Record<string, unknown>,
  opts?: { firstName?: string }
): Record<string, string> {
  const company = business.company as Record<string, string> | undefined
  const product = business.product as { name?: string } | undefined
  const voice = business.voice as { signature?: string } | undefined

  return {
    company: lead.name?.trim() || 'Компания',
    first_name: opts?.firstName ?? process.env.OUTREACH_DEFAULT_FIRST_NAME ?? 'коллега',
    industry: lead.category?.trim() || 'вашей отрасли',
    city: lead.city?.trim() || '',
    calendar_url: company?.calendar_url || 'https://cal.com',
    signature: voice?.signature || '— Команда',
    our_name: company?.name || 'Rahmet Labs',
    product_name: product?.name || 'цифровые решения',
  }
}
