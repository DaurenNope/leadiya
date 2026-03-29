import { pgTable, timestamp, uuid, text, boolean, jsonb, integer } from 'drizzle-orm/pg-core'

export const timestamps = {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  bin: text('bin').unique(),
  city: text('city'),
  address: text('address'),
  website: text('website'),
  category: text('category'),
  /** Rubric / category labels shown on the 2GIS card (not the discovery search slice). Joined with " · ". */
  twogisCardCategory: text('twogis_card_category'),
  source: text('source'),
  sourceUrl: text('source_url'),
  email: text('email'),
  isWaReachable: boolean('is_wa_reachable').default(false),
  instagram: text('instagram'),
  whatsapp: text('whatsapp'),
  telegram: text('telegram'),
  facebook: text('facebook'),
  vk: text('vk'),
  twitter: text('twitter'),
  youtube: text('youtube'),
  status: text('status').default('pending'),
  rawData: jsonb('raw_data'),
  okedCode: text('oked_code'),
  okedName: text('oked_name'),
  employeeBand: text('employee_band'),
  legalStatus: text('legal_status'),
  icpScore: integer('icp_score').default(0),
  rating2gis: text('rating_2gis'),
  reviewsCount2gis: integer('reviews_count_2gis').default(0),
  openingHours: jsonb('opening_hours'),
  lat: text('lat'),
  lng: text('lng'),
  discoveryLevel: integer('discovery_level').default(1),
  /** Per-source enrichment tracking: { website: { at, status }, stat: { at, status }, ... } */
  enrichmentSources: jsonb('enrichment_sources').default({}),
  lastEnrichedAt: timestamp('last_enriched_at'),
  lastScrapedAt: timestamp('last_scraped_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const companies = leads; // Alias for backward compatibility

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  fullName: text('full_name'),
  role: text('role'),
  phone: text('phone').unique(),
  email: text('email'),
  isPrimary: boolean('is_primary').default(false),
  source: text('source'),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const tenders = pgTable('tenders', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => leads.id),
  portal: text('portal'),
  lotNumber: text('lot_number').unique(),
  subject: text('subject'),
  budgetKzt: text('budget_kzt'),
  status: text('status').default('open'),
  companyRole: text('company_role'),
  publishedAt: timestamp('published_at'),
  awardedAt: timestamp('awarded_at'),
  category: text('category'),
  region: text('region'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  active: boolean('active').default(true),
  icpConfig: jsonb('icp_config').default({}),
  ownerId: uuid('owner_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeCustomerId: text('stripe_customer_id'),
  exportsUsed: integer('exports_used').default(0),
  quotaResetAt: timestamp('quota_reset_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  ...timestamps,
})

export const outreachLog = pgTable('outreach_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  /** Lead this touchpoint belongs to (CRM); use with or without contactId. */
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id),
  channel: text('channel').notNull(),
  direction: text('direction').notNull(),
  body: text('body'),
  status: text('status'),
  sentAt: timestamp('sent_at'),
  /** WhatsApp JID (e.g. 7...@s.whatsapp.net) for inbound rows when lead is unknown. */
  waPeer: text('wa_peer'),
  ...timestamps,
})

export const scraperRuns = pgTable('scraper_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  scraper: text('scraper').notNull(),
  status: text('status').notNull(),
  resultsCount: text('results_count'),
  /** Total firm detail navigation attempts (includes attempts that were skipped due to duplicates or parsing failures). */
  detailAttempts: integer('detail_attempts').default(0).notNull(),
  /** Count of duplicates skipped (both by URL and by normalized name+city session de-dupe). */
  totalSkipped: integer('total_skipped').default(0).notNull(),
  /** Number of list pages processed that returned >=1 firm. */
  listPagesCompleted: integer('list_pages_completed').default(0).notNull(),
  /** Max consecutive pages with 0 firms (used to detect empty slice / blockage). */
  emptyPageStreakMax: integer('empty_page_streak_max').default(0).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
})
