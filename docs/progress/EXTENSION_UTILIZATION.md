---
title: Browser extension — how we use it
last_reviewed: 2026-03-23
status: canonical
---

# Browser extension — how to utilize it

The **WXT extension** (`apps/extension/`) is a **parallel discovery path** to the headless API scraper. It is **not** required for dashboard or API-only workflows.

## What it does

1. **Extract a single firm** from the active 2GIS tab (firm page) and queue it for sync.
2. **Bulk scrape** search-result pages: collect `/firm/` links, open each in a background tab, extract, close tab, push to API.
3. **POST batches** to `POST /api/leads/bulk` on your API (default `http://localhost:3041` for local dev), same shape as manual extension payloads.

Because extraction runs in a **real Chrome profile**, it can survive UI/captcha situations that headless Playwright hits more often. It does **not** magically bypass all bot checks; it uses **your** session.

## When to use it

| Situation | Prefer |
|-----------|--------|
| Large unattended runs, checkpoints, many cities | **API** `POST /api/scrapers/2gis` or `run2GisScraper` scripts |
| Quick capture while browsing 2GIS, or captcha-heavy stretches | **Extension** |
| Mixed | Extension for “hot” slices; API for volume |

## Operator setup

1. Build/load the extension (WXT): `npm run build` or dev mode in `apps/extension` per that package’s README.
2. In the popup, set **API URL** to your API (e.g. `http://localhost:3041` or deployed host).
3. Choose **city** + **category** (or paste a **direct 2GIS search URL**).
4. Use **Scrape current** on a firm page, or **Bulk scrape** on a search page.

Ensure **API + Postgres** are up; optional **Redis + workers** enqueue enrichment after bulk inserts (see `leads` route).

## Dashboard “EXT_LINK”

The dashboard probes `ws://localhost:8765` as a **legacy/extension-bridge** hint. The current extension syncs over **HTTP to the API**, not that WebSocket. Treat the badge as **optional** unless you run a separate bridge service.

## CRM / WhatsApp

Outreach is **dashboard + API** (`/api/outreach/*`, YAML templates, `wa.me` links). The extension does **not** send WhatsApp; it only **feeds leads** (including `whatsapp` fields when present on the card).
