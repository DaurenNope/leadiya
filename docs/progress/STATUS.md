---
title: Build & delivery status
last_reviewed: 2026-03-21
status: canonical
---

# Status

## Architecture

Monorepo with a **discovery-then-enrichment pipeline**:

1. **Discovery** (2GIS scraper) writes leads to Postgres and stops.
2. After discovery, **enrichment jobs** are enqueued per-source via BullMQ.
3. Each enrichment source has its own queue and worker with independent concurrency.
4. `enrichmentSources` jsonb on leads tracks per-source status and timestamps.

## Shipped

| Area | Notes |
|------|--------|
| Monorepo | npm workspaces + Turbo. |
| `@leadiya/db` | Canonical schema with `enrichmentSources`, `lastEnrichedAt`, `lastScrapedAt`. Drizzle migrations generated from schema. Seed script for dev. |
| `@leadiya/scrapers` | 2GIS page-by-page, website enrichment (HTTP+Playwright), stat.gov.kz, uchet.kz (token-gated), goszakup (token-gated). |
| `@leadiya/logic` | LeadFactory, DiscoveryLogic. |
| API | Hono: companies CRUD, CSV export, scrapers (single-flight, runId), bulk actions, stats. Auth enabled with `AUTH_BYPASS`. |
| Dashboard | Toast notifications, bulk actions (enrich/archive/export), enrichment status display, settings with pipeline overview. Zero lint errors. |
| Workers | BullMQ: discovery, 4 enrichment workers (website/stat/uchet/goszakup), freshness watchdog, tender monitor. |
| Extension | WXT MV3 + WebSocket bridge. |
| Tests | vitest: 36 tests across 4 files (scraper extractors, checkpoint, API routes, enrichment pipeline). |
| Lint | ESLint for dashboard, tsc --noEmit for API and workers. All pass via `npm run lint`. |
| CI | GitHub Actions: build + lint + test on push/PR to main. |
| Docker | Multi-stage Dockerfile: API, Workers, Dashboard targets. |

## External data sources

| Source | Status | Auth needed |
|--------|--------|-------------|
| 2GIS (browser) | Working | None (Playwright) |
| Website scraper | Working | None |
| stat.gov.kz | Degraded (404 as of March 2026) | None |
| uchet.kz (pk.uchet.kz) | Ready (needs `UCHET_API_TOKEN`) | Token from pk.uchet.kz cabinet |
| goszakup.gov.kz | Ready (needs `GOSZAKUP_API_TOKEN`) | Bearer token from OWS portal |
| data.egov.kz | Not yet implemented | apiKey from portal |

## Verification

```bash
npm run build          # all 10 packages
npm run lint           # dashboard ESLint + backend tsc
npm test               # 36 tests passing
```
