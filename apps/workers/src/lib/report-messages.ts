import type { ReportBrand } from './worker-business-config.js'

export function buildDailyDigestBody(
  brand: ReportBrand,
  stats: { totalSent: number; totalReceived: number },
  seqStats: { active: number; completed: number; cold: number; positive: number },
  hotList: string,
  briefsBlock: string,
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
  return body
}

export function buildWeeklySummaryBody(
  brand: ReportBrand,
  leadStats: { total: number; thisWeek: number },
  stats: { sent: number; received: number },
  seqStats: { started: number; completed: number; cold: number },
  replyRate: number,
  conversionPct: number,
): string {
  return `📊 Недельный отчёт ${brand.productName}

📦 Лидов всего: ${leadStats.total} (+${leadStats.thisWeek} за неделю)
📤 Отправлено сообщений: ${stats.sent}
📥 Получено ответов: ${stats.received}
📈 Reply rate: ${replyRate}%

🔄 Начато последовательностей: ${seqStats.started}
✅ Успешно завершено: ${seqStats.completed}
❄️ Отказов: ${seqStats.cold}

Конверсия: ${conversionPct}% → встреча/сделка

${brand.botSignoff}`
}

export const hotLeadsQuietLine = 'Пока тихо — продолжаем работать!'
