/** Canonical lead shape (matches API bulk schema). */
export type LeadPayload = {
  name: string
  address: string
  phones: string[]
  emails: string[]
  website: string
  instagram: string
  whatsapp: string
  telegram: string
  facebook: string
  rating: number | null
  bin: string
  lat: string
  lng: string
  sourceUrl: string
  city?: string
  category?: string
}

export type SinkId = 'api' | 'webhook' | 'sheets'

export type SinkDeliveryMeta = {
  attempts: number
  nextEligibleAt?: number
  lastError?: string
}

export type QueuedLead = {
  id: string
  lead: LeadPayload
  /** Which automatic sinks have successfully received this lead. */
  delivered: Partial<Record<SinkId, boolean>>
  /** Per-sink retry metadata for reliability. */
  deliveryMeta?: Partial<Record<SinkId, SinkDeliveryMeta>>
}

export type DeadLetterLead = {
  id: string
  sink: SinkId
  reason: string
  failedAt: string
  lead: LeadPayload
}
