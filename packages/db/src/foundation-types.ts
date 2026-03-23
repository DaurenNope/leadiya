/** Branded-style aliases for domain IDs (plain strings at runtime). */
export type UUID = string
export type BIN = string

export const CompanyStatus = {
  UNKNOWN: 'unknown',
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  LIQUIDATED: 'liquidated',
  SUSPENDED: 'suspended',
} as const

export type CompanyStatusValue = (typeof CompanyStatus)[keyof typeof CompanyStatus]

export interface FoundationPhone {
  number: string
  type: string
  isPrimary?: boolean
  source?: string
}

export interface FoundationEmail {
  address: string
  type: string
  isPrimary?: boolean
  source?: string
}

export interface FoundationSocialProfile {
  platform: string
  url: string
}

export interface FoundationContact {
  id: UUID
  role: string
  seniority: string
  phones: FoundationPhone[]
  emails: FoundationEmail[]
  socialProfiles: FoundationSocialProfile[]
  discoveredAt: string
  sources: string[]
}

export interface FoundationLocation {
  type: string
  country: string
  city: string
  address?: string
  isPrimary?: boolean
}

export interface FoundationIndustry {
  code: string
  name: string
  source: string
  isPrimary: boolean
}

export interface FoundationCompany {
  name: string
  status: CompanyStatusValue
  bin?: BIN
  oked?: Array<{ code: string; name: string }>
}

export interface FoundationSignals {
  hasDirectPhone: boolean
  hasWebsite: boolean
  hasSocialMedia: boolean
  tags: string[]
  dataQualityScore: number
}

export interface FoundationLead {
  id: UUID
  tenantId: UUID
  company: FoundationCompany
  locations: FoundationLocation[]
  contacts: FoundationContact[]
  industries: FoundationIndustry[]
  signals: FoundationSignals
  sourceData: Record<string, unknown>
  enrichment: {
    enrichmentSources: string[]
    isDuplicate: boolean
  }
  pipeline: {
    state: string
    source: string
    tags: string[]
    notes: string[]
    contactAttempts: number
  }
  exports: {
    timesExported: number
    exportFormats: string[]
    customerIds: string[]
  }
  createdAt: string
  updatedAt: string
  version: number
}
