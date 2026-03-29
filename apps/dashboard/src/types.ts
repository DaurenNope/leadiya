export interface Contact {
  id: string
  leadId: string
  fullName?: string | null
  role?: string | null
  phone?: string | null
  email?: string | null
  isPrimary: boolean
  source?: string | null
  sourceUrl?: string | null
}

export interface EnrichmentSourceStatus {
  at: string
  status: string
  emails?: number
  tenders?: number
}

export interface Lead {
  id: string
  name: string
  bin: string | null
  city: string | null
  address: string | null
  website: string | null
  /** Primary email on the company row (may duplicate contacts). */
  email?: string | null
  /** 2GIS firm page URL when source is 2gis. */
  sourceUrl?: string | null
  status: string
  source: string | null
  createdAt: string
  okedCode?: string | null
  okedName?: string | null
  employeeBand?: string | null
  legalStatus?: string | null
  icpScore?: number
  isHot?: boolean
  contacts?: Contact[]
  phones?: string[]
  emails?: string[]
  instagram?: string | null
  whatsapp?: string | null
  telegram?: string | null
  category?: string | null
  /** Rubric line(s) from the 2GIS card (e.g. «Гондольная канатная дорога»), not the discovery search preset. */
  twogisCardCategory?: string | null
  rating2gis?: string | null
  reviewsCount2gis?: number | null
  openingHours?: Record<string, string> | null
  lat?: string | null
  lng?: string | null
  facebook?: string | null
  vk?: string | null
  twitter?: string | null
  youtube?: string | null
  discoveryLevel?: number | null
  enrichmentSources?: Record<string, EnrichmentSourceStatus> | null
  lastEnrichedAt?: string | null
  lastScrapedAt?: string | null
}
