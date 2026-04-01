import { describe, it, expect } from 'vitest'
import { buildConversationHistory } from './inbound-reply.js'

describe('buildConversationHistory', () => {
  it('keeps latest lines within character budget', () => {
    const rows = [
      { direction: 'outbound' as const, body: 'one' },
      { direction: 'inbound' as const, body: 'two two' },
      { direction: 'outbound' as const, body: 'three three three' },
      { direction: 'inbound' as const, body: 'four four four four' },
    ]

    const history = buildConversationHistory(rows, 50)
    expect(history.length).toBe(2)
    expect(history[0]).toContain('Us: three three three')
    expect(history[1]).toContain('Them: four four four four')
  })

  it('returns oldest-to-newest order for kept lines', () => {
    const rows = [
      { direction: 'inbound' as const, body: 'hello' },
      { direction: 'outbound' as const, body: 'hi there' },
    ]
    const history = buildConversationHistory(rows, 1000)
    expect(history).toEqual(['Them: hello', 'Us: hi there'])
  })
})
