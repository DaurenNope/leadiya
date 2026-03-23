---
title: 2GIS extraction strategy
last_reviewed: 2026-03-21
status: canonical
---

# 2GIS: allowed approaches

## Out of scope (product decision)

**Official 2GIS Catalog HTTP API** (direct server calls with a commercial key) is **not** a supported direction. Do not plan features on it.

## In scope

| Mode | Status | Notes |
|------|--------|--------|
| **Browser + DOM (page-by-page)** | **Shipped** | Search URL, page-by-page navigation (`/page/1`, `/page/2`, ...), detail `page.goto`, phone unmask clicks. See `packages/scrapers/src/twogis.ts`. |
| **Browser + network intercept** | **Implemented (list phase)** | `packages/scrapers/src/twogis-list-collector.ts` taps `catalog.api.2gis.*` JSON during search. Can be wired per-page in future. |
| **Crawlee + Playwright** | **Shipped** | `run2GisScraper` uses Crawlee `PlaywrightCrawler`, one queued request per city/category, `maxConcurrency: 1`, 4-hour timeout per request. |

## What the code does today

**List phase (page-by-page):**
- Navigates to `https://2gis.kz/{citySlug}/search/{category}` then `/page/2`, `/page/3`, etc.
- Collects firm `/firm/` links from the current page DOM (no scrolling).
- Stops after `MAX_EMPTY_PAGES` (3) consecutive pages with no new firms.
- City slugs are mapped in `CITY_SLUGS` record; unknown cities fallback to `.toLowerCase()`.

**Detail phase** (each firm URL): `page.goto` firm page, "show phone" clicks, `page.evaluate` (text, links, `link.2gis.com` decode), then upsert `leads` / `contacts` with `scraper_runs` audit.

**Discovery-only (no inline enrichment):**
- The 2GIS scraper **only writes leads** — no website enrichment happens inline.
- After a run completes, the caller enqueues enrichment jobs via the BullMQ pipeline.
- `run2GisScraper()` returns `{ total, runId, leadIds }`.

**Resume checkpoints** (`resumeCheckpoint: true`):
- Page-based checkpoints under `.twogis-checkpoints/` (or `TWOGIS_CHECKPOINT_DIR`).
- Tracks `page`, `firmIndexOnPage`, `totalProcessed`, `totalSkipped`.
- On crash, re-run the same city/category; resumes from exact page and firm index.
- Checkpoint version 2 (page-based, replaces V1 scroll-based).

**Stage 2 (website enrichment)** is now handled by the enrichment pipeline workers, not inline.

## Decision log

| Date | Decision |
|------|-----------|
| 2026-03-21 | Official Catalog API: out of scope. |
| 2026-03-21 | Page-by-page pagination replaces infinite scrolling. |
| 2026-03-21 | Inline enrichment removed — enrichment is queue-based pipeline. |
| 2026-03-21 | Checkpoint V2: page + firmIndexOnPage for exact resume. |
