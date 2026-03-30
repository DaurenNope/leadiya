import { env } from '@leadiya/config'

export type Intent =
  | 'positive'
  | 'negative'
  | 'pricing'
  | 'timeline'
  | 'meeting'
  | 'referral'
  | 'question'
  | 'qualification'
  | 'unknown'

export interface ClassifyResult {
  intent: Intent
  confidence: 'high' | 'low'
  referralContact?: { name?: string; phone?: string }
}

const POSITIVE = ['интересно', 'расскажите', 'давайте', 'хорошо', 'ок', 'можно', 'да', 'yes', 'sure', 'interesting']
const NEGATIVE = ['нет', 'не интересует', 'отстаньте', 'спам', 'не пишите', 'отписаться', 'no', 'stop', 'не надо', 'не нужно']
const PRICING = ['сколько стоит', 'цена', 'прайс', 'бюджет', 'стоимость', 'how much', 'pricing', 'price']
const TIMELINE = ['сколько времени', 'сроки', 'когда готово', 'timeline', 'как долго', 'дедлайн']
const MEETING = ['созвонимся', 'встретимся', 'звоните', 'позвоните', 'когда можно', 'давайте созвонимся', 'call', 'zoom']

const REFERRAL_PATTERNS = [
  /(?:поговорите|обратитесь|свяжитесь|напишите|позвоните)\s+(?:с\s+)?(\S+)/i,
  /(?:вот\s+)?(?:номер|телефон|контакт)\s+(\S+)/i,
  /(?:ответственн\S+|директор\S*|руководител\S+|менеджер\S*)\s+[-—:]\s*(\S+)/i,
]

const PHONE_RE = /(?:\+?7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/

function keywordMatch(text: string): Intent | null {
  const lower = text.toLowerCase().trim()
  if (NEGATIVE.some(k => lower.includes(k))) return 'negative'
  if (PRICING.some(k => lower.includes(k))) return 'pricing'
  if (TIMELINE.some(k => lower.includes(k))) return 'timeline'
  if (MEETING.some(k => lower.includes(k))) return 'meeting'
  if (PHONE_RE.test(text)) return 'referral'
  if (POSITIVE.some(k => lower.includes(k))) return 'positive'
  return null
}

export function extractContactFromMessage(text: string): { name?: string; phone?: string } | null {
  const phone = text.match(PHONE_RE)?.[0]?.replace(/[\s()-]/g, '') ?? null
  if (!phone) return null
  let name: string | undefined
  for (const p of REFERRAL_PATTERNS) {
    const m = text.match(p)
    if (m?.[1] && !PHONE_RE.test(m[1])) { name = m[1]; break }
  }
  return { name, phone }
}

async function classifyWithOllama(text: string): Promise<Intent> {
  const ollamaUrl = env.OLLAMA_URL || 'http://localhost:11434'
  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        prompt: `Classify this business message reply into ONE category. Reply with ONLY the category name.
Categories: positive, negative, pricing, timeline, meeting, referral, question
Message: "${text.slice(0, 500)}"
Category:`,
        stream: false,
        options: { temperature: 0.1, num_predict: 10 },
      }),
    })
    if (!res.ok) return 'unknown'
    const data = (await res.json()) as { response?: string }
    const raw = data.response?.trim().toLowerCase() ?? ''
    const valid: Intent[] = ['positive', 'negative', 'pricing', 'timeline', 'meeting', 'referral', 'question']
    return valid.find(v => raw.includes(v)) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function classifyReply(text: string): Promise<ClassifyResult> {
  const kw = keywordMatch(text)

  if (kw && kw !== 'referral') return { intent: kw, confidence: 'high' }

  if (kw === 'referral' || PHONE_RE.test(text)) {
    const contact = extractContactFromMessage(text)
    if (contact?.phone) return { intent: 'referral', confidence: 'high', referralContact: contact }
  }

  if (text.trim().length <= 5) {
    const l = text.toLowerCase().trim()
    if (['да', 'ок', 'yes', 'ok'].includes(l)) return { intent: 'positive', confidence: 'high' }
    if (['нет', 'no'].includes(l)) return { intent: 'negative', confidence: 'high' }
  }

  const ollamaIntent = await classifyWithOllama(text)
  const result: ClassifyResult = { intent: ollamaIntent, confidence: 'low' }
  if (ollamaIntent === 'referral') {
    const contact = extractContactFromMessage(text)
    if (contact?.phone) result.referralContact = contact
  }
  return result
}
