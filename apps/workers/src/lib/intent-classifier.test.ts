import { describe, expect, it } from 'vitest'
import { classifyReply } from './intent-classifier.js'

describe('classifyReply', () => {
  it('treats spam and no as negative', async () => {
    await expect(classifyReply('Спам')).resolves.toMatchObject({ intent: 'negative', confidence: 'high' })
    await expect(classifyReply('это спам')).resolves.toMatchObject({ intent: 'negative', confidence: 'high' })
    await expect(classifyReply('Нет')).resolves.toMatchObject({ intent: 'negative', confidence: 'high' })
    await expect(classifyReply('Саламалекум, коллега?\n\nНет')).resolves.toMatchObject({
      intent: 'negative',
      confidence: 'high',
    })
  })

  it('classifies short да/нет without Ollama', async () => {
    await expect(classifyReply('нет')).resolves.toMatchObject({ intent: 'negative', confidence: 'high' })
    await expect(classifyReply('да')).resolves.toMatchObject({ intent: 'positive', confidence: 'high' })
  })

  it('classifies multi-line rejection as negative', async () => {
    await expect(classifyReply('Привет\n\nНет, не интересно')).resolves.toMatchObject({
      intent: 'negative',
      confidence: 'high',
    })
  })

  it('classifies skeptical зачем as question (keyword)', async () => {
    await expect(classifyReply('Зачем?')).resolves.toMatchObject({ intent: 'question', confidence: 'high' })
    await expect(classifyReply('зачем вы пишете')).resolves.toMatchObject({ intent: 'question', confidence: 'high' })
  })
})
