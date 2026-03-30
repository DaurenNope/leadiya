import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { env } from '@leadiya/config'
import type { Intent } from './intent-classifier.js'

interface AutoReplyConfig { trigger: string[]; response: string }
interface BusinessConfig {
  company?: { name?: string; calendar_url?: string; website?: string }
  voice?: { signature?: string }
  product?: { description?: string; value_props?: string[]; services?: Array<{ name: string; description: string }> }
}

let _autoReplies: Record<string, AutoReplyConfig> | null = null
let _business: BusinessConfig | null = null

function loadAutoReplies(): Record<string, AutoReplyConfig> {
  if (_autoReplies) return _autoReplies
  try {
    const raw = readFileSync(join(process.cwd(), 'config', 'sequences.yml'), 'utf8')
    const doc = parseYaml(raw) as { responses?: { auto_replies?: Record<string, AutoReplyConfig> } }
    _autoReplies = doc.responses?.auto_replies ?? {}
  } catch { _autoReplies = {} }
  return _autoReplies
}

function loadBusiness(): BusinessConfig {
  if (_business) return _business
  try {
    const raw = readFileSync(join(process.cwd(), 'config', 'business.yml'), 'utf8')
    _business = parseYaml(raw) as BusinessConfig
  } catch { _business = {} }
  return _business
}

export interface ResponseContext {
  leadName: string
  leadCategory?: string | null
  leadCity?: string | null
  inboundMessage: string
  conversationHistory?: string[]
  qualificationData?: Record<string, unknown> | null
}

export async function generateResponse(
  intent: Intent,
  ctx: ResponseContext,
): Promise<{ body: string; channel: 'whatsapp' } | null> {
  const biz = loadBusiness()
  const cal = biz.company?.calendar_url || 'https://cal.com/rahmetlabs/30min'
  const sig = biz.voice?.signature || '— Команда Rahmet Labs'

  switch (intent) {
    case 'positive':
      return { channel: 'whatsapp', body: `Отлично! Рад, что заинтересовались.

Подскажите, что сейчас актуальнее всего для ${ctx.leadName}?

• Сайт (лендинг, корп. сайт, магазин)
• Автоматизация (CRM, боты, интеграции)
• Мобильное приложение
• Что-то другое

Это поможет подготовить предложение точно под вас.

${sig}` }

    case 'negative':
      return { channel: 'whatsapp', body: `Понял, спасибо за ответ! Не буду беспокоить.

Если в будущем появится потребность — всегда на связи 🙏

${sig}` }

    case 'pricing': {
      const ar = loadAutoReplies()
      const tpl = ar.pricing?.response
      return { channel: 'whatsapp', body: tpl ? tpl.replace('{{calendar_url}}', cal) :
`Стоимость зависит от проекта:

• Лендинг: от 300 000 тг
• Корпоративный сайт: от 500 000 тг
• Интернет-магазин: от 800 000 тг
• Автоматизация/CRM: от 500 000 тг

Расскажите подробнее о задаче — подготовлю точную оценку.

Или запишитесь на бесплатную консультацию: ${cal}

${sig}` }
    }

    case 'timeline': {
      const ar = loadAutoReplies()
      return { channel: 'whatsapp', body: ar.timeline?.response ||
`Зависит от проекта:
• Лендинг: 1-2 недели
• Корпоративный сайт: 3-4 недели
• Веб-сервис: 4-8 недель

А какой у вас дедлайн?

${sig}` }
    }

    case 'meeting':
      return { channel: 'whatsapp', body: `Отлично, давайте!

Выберите удобное время: ${cal}

Если не найдёте подходящий слот — напишите, договоримся напрямую.

${sig}` }

    case 'referral':
      return { channel: 'whatsapp', body: `Спасибо за контакт! Свяжусь с ним/ней. Хорошего дня! 🙏

${sig}` }

    case 'qualification':
      return await generateQualificationResponse(ctx)

    case 'question':
    case 'unknown':
      return await generateOllamaResponse(ctx)

    default:
      return null
  }
}

/**
 * Qualification flow: ask progressively deeper questions to extract a technical brief.
 * Tracks what we already know in qualificationData and asks for what's missing.
 */
async function generateQualificationResponse(ctx: ResponseContext): Promise<{ body: string; channel: 'whatsapp' } | null> {
  const biz = loadBusiness()
  const sig = biz.voice?.signature || '— Команда Rahmet Labs'
  const qd = (ctx.qualificationData ?? {}) as Record<string, unknown>

  if (!qd.service) {
    return { channel: 'whatsapp', body: `Отлично! Чтобы подготовить точное предложение, пара вопросов:

Какой проект вас интересует?
1️⃣ Сайт (лендинг, корп. сайт, магазин)
2️⃣ Автоматизация (CRM, боты, интеграции)
3️⃣ Мобильное приложение
4️⃣ Другое

${sig}` }
  }

  if (!qd.description) {
    return { channel: 'whatsapp', body: `Понял, ${String(qd.service)}!

Расскажите подробнее:
• Что должен делать проект? Основные функции?
• Есть ли примеры/референсы похожих решений?
• Кто целевая аудитория?

Чем подробнее — тем точнее оценка 🎯

${sig}` }
  }

  if (!qd.budget) {
    return { channel: 'whatsapp', body: `Спасибо за детали! Звучит интересно.

Ещё пара моментов:
• Какой примерный бюджет вы рассматриваете?
• Есть ли дедлайн по срокам?
• Нужны ли интеграции (1С, Kaspi, WhatsApp, CRM)?

${sig}` }
  }

  return { channel: 'whatsapp', body: `Отлично, у меня достаточно информации для предложения!

Вот что я зафиксировал:
📋 Проект: ${String(qd.service)}
📝 Описание: ${String(qd.description).slice(0, 200)}
💰 Бюджет: ${String(qd.budget)}
⏰ Сроки: ${String(qd.timeline || 'обсудим')}

Подготовлю детальное предложение и пришлю в ближайшее время.

Или можем обсудить на звонке: ${biz.company?.calendar_url || 'https://cal.com/rahmetlabs/30min'}

${sig}` }
}

async function generateOllamaResponse(ctx: ResponseContext): Promise<{ body: string; channel: 'whatsapp' } | null> {
  const ollamaUrl = env.OLLAMA_URL || 'http://localhost:11434'
  const biz = loadBusiness()
  const services = biz.product?.services?.map(s => `${s.name}: ${s.description}`).join('\n') || 'websites, automation, CRM, mobile apps'

  const history = ctx.conversationHistory?.length
    ? '\n\nConversation so far:\n' + ctx.conversationHistory.slice(-6).join('\n')
    : ''

  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        prompt: `You are a sales assistant for ${biz.company?.name || 'Rahmet Labs'}, a digital solutions agency in Kazakhstan.
Services:
${services}
Tone: professional, friendly, direct. Language: Russian. Keep it short (2-4 sentences).
Calendar link: ${biz.company?.calendar_url || 'https://cal.com/rahmetlabs/30min'}
Signature: ${biz.voice?.signature || '— Команда Rahmet Labs'}

Lead: "${ctx.leadName}" (${ctx.leadCategory || 'business'}, ${ctx.leadCity || 'KZ'})${history}

Their latest message: "${ctx.inboundMessage.slice(0, 500)}"

Your goal: understand their needs, qualify the lead, move toward a meeting or detailed project brief.
Write a natural WhatsApp reply. End with the signature.

Reply:`,
        stream: false,
        options: { temperature: 0.7, num_predict: 250 },
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { response?: string }
    const body = data.response?.trim()
    if (!body) return null
    return { channel: 'whatsapp', body }
  } catch {
    return null
  }
}

/**
 * Extract qualification data from a message given the current state.
 * Returns updated qualificationData fields.
 */
export function extractQualificationFromMessage(
  message: string,
  currentData: Record<string, unknown>,
): Record<string, unknown> {
  const lower = message.toLowerCase()
  const updates: Record<string, unknown> = {}

  if (!currentData.service) {
    if (/сайт|лендинг|магазин|website|landing/i.test(message)) updates.service = 'Сайт'
    else if (/автоматизац|crm|бот|интеграц/i.test(message)) updates.service = 'Автоматизация'
    else if (/приложени|мобильн|app|ios|android/i.test(message)) updates.service = 'Мобильное приложение'
    else if (/1|один/i.test(lower) && lower.length < 10) updates.service = 'Сайт'
    else if (/2|два/i.test(lower) && lower.length < 10) updates.service = 'Автоматизация'
    else if (/3|три/i.test(lower) && lower.length < 10) updates.service = 'Мобильное приложение'
  }

  if (!currentData.description && message.length > 30) {
    updates.description = message.slice(0, 1000)
  }

  if (!currentData.budget) {
    const budgetMatch = message.match(/(\d[\d\s]*(?:000|тг|тенге|₸|млн|тыс))/i)
    if (budgetMatch) updates.budget = budgetMatch[1].trim()
    if (/бюджет.{0,20}нет|не определ|обсуд/i.test(message)) updates.budget = 'Обсудим'
  }

  if (!currentData.timeline) {
    const timeMatch = message.match(/(\d+\s*(?:недел|месяц|дн|week|month|day))/i)
    if (timeMatch) updates.timeline = timeMatch[1].trim()
    if (/срочно|asap|быстр/i.test(message)) updates.timeline = 'Срочно'
  }

  if (!currentData.integrations) {
    const integrations: string[] = []
    if (/1с|1c/i.test(message)) integrations.push('1С')
    if (/kaspi|каспи/i.test(message)) integrations.push('Kaspi')
    if (/whatsapp/i.test(message)) integrations.push('WhatsApp')
    if (/telegram/i.test(message)) integrations.push('Telegram')
    if (integrations.length) updates.integrations = integrations
  }

  return updates
}
