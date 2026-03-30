import type { ReportBrand } from './worker-business-config.js'

export function buildDailyDigestBody(
  brand: ReportBrand,
  stats: { totalSent: number; totalReceived: number },
  seqStats: { active: number; completed: number; cold: number; positive: number },
  hotList: string,
  briefsBlock: string,
  /** e.g. "🏢 Acme (slug)" — prepended when sending per-tenant digests */
  tenantHeader?: string,
): string {
  let body = `📊 Ежедневный отчёт ${brand.productName}

📤 Отправлено: ${stats.totalSent}
📥 Получено ответов: ${stats.totalReceived}

🔄 Активных последовательностей: ${seqStats.active}
✅ Завершено (за 24ч): ${seqStats.completed}
❄️ Отказов (за 24ч): ${seqStats.cold}
🔥 Горячих лидов: ${seqStats.positive}

Горячие лиды:
${hotList}`

  if (briefsBlock) {
    body += `\n\nГотовые брифы:\n${briefsBlock}`
  }

  body += `\n\n${brand.botSignoff}`
  if (tenantHeader) {
    body = `${tenantHeader}\n\n${body}`
  }
  return body
}

export function buildWeeklySummaryBody(
  brand: ReportBrand,
  leadStats: { total: number; thisWeek: number },
  stats: { sent: number; received: number },
  seqStats: { started: number; completed: number; cold: number },
  replyRate: number,
  conversionPct: number,
  tenantHeader?: string,
): string {
  let text = `📊 Недельный отчёт ${brand.productName}

📦 Лидов всего: ${leadStats.total} (+${leadStats.thisWeek} за неделю)
📤 Отправлено сообщений: ${stats.sent}
📥 Получено ответов: ${stats.received}
📈 Reply rate: ${replyRate}%

🔄 Начато последовательностей: ${seqStats.started}
✅ Успешно завершено: ${seqStats.completed}
❄️ Отказов: ${seqStats.cold}

Конверсия: ${conversionPct}% → встреча/сделка

${brand.botSignoff}`
  if (tenantHeader) {
    text = `${tenantHeader}\n\n${text}`
  }
  return text
}

export const hotLeadsQuietLine = 'Пока тихо — продолжаем работать!'
