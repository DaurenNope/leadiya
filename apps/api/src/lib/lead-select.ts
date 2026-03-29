import { companies } from '@leadiya/db'

/**
 * Lead columns for list + table views — excludes `raw_data` (often huge scraper payloads).
 * Detail fetches use `leadDetailFields`; opening hours / enrichment still load for the side panel.
 */
export const leadListFields = {
  id: companies.id,
  name: companies.name,
  bin: companies.bin,
  city: companies.city,
  address: companies.address,
  website: companies.website,
  category: companies.category,
  twogisCardCategory: companies.twogisCardCategory,
  source: companies.source,
  sourceUrl: companies.sourceUrl,
  email: companies.email,
  isWaReachable: companies.isWaReachable,
  instagram: companies.instagram,
  whatsapp: companies.whatsapp,
  telegram: companies.telegram,
  facebook: companies.facebook,
  vk: companies.vk,
  twitter: companies.twitter,
  youtube: companies.youtube,
  status: companies.status,
  okedCode: companies.okedCode,
  okedName: companies.okedName,
  employeeBand: companies.employeeBand,
  legalStatus: companies.legalStatus,
  icpScore: companies.icpScore,
  rating2gis: companies.rating2gis,
  reviewsCount2gis: companies.reviewsCount2gis,
  lat: companies.lat,
  lng: companies.lng,
  discoveryLevel: companies.discoveryLevel,
  lastEnrichedAt: companies.lastEnrichedAt,
  lastScrapedAt: companies.lastScrapedAt,
  createdAt: companies.createdAt,
  updatedAt: companies.updatedAt,
} as const

/** Single-lead API (side panel): everything public except raw scrape blob. */
export const leadDetailFields = {
  ...leadListFields,
  openingHours: companies.openingHours,
  enrichmentSources: companies.enrichmentSources,
} as const

/** CSV / JSON export — only columns that appear in the file (no JSONB blobs). */
export const leadExportFields = {
  id: companies.id,
  name: companies.name,
  bin: companies.bin,
  city: companies.city,
  category: companies.category,
  twogisCardCategory: companies.twogisCardCategory,
  website: companies.website,
  email: companies.email,
  whatsapp: companies.whatsapp,
  instagram: companies.instagram,
  telegram: companies.telegram,
  status: companies.status,
  employeeBand: companies.employeeBand,
  legalStatus: companies.legalStatus,
  okedCode: companies.okedCode,
  okedName: companies.okedName,
  icpScore: companies.icpScore,
  rating2gis: companies.rating2gis,
  createdAt: companies.createdAt,
} as const
