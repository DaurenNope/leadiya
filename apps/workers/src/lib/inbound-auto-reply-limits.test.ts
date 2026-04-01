import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { maxInboundAutoReplies } from './inbound-auto-reply-limits.js'

describe('maxInboundAutoReplies', () => {
  const orig = process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES

  beforeEach(() => {
    if (orig === undefined) delete process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES
    else process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES = orig
  })

  afterEach(() => {
    if (orig === undefined) delete process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES
    else process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES = orig
  })

  it('defaults to 5 when unset', () => {
    delete process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES
    expect(maxInboundAutoReplies()).toBe(5)
  })

  it('respects numeric env', () => {
    process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES = '25'
    expect(maxInboundAutoReplies()).toBe(25)
  })

  it('clamps invalid low values to default', () => {
    process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES = '0'
    expect(maxInboundAutoReplies()).toBe(5)
  })

  it('caps at 100', () => {
    process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES = '999'
    expect(maxInboundAutoReplies()).toBe(100)
  })
})
