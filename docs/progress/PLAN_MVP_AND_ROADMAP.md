---
title: MVP and full project plan (build, test, acquire)
last_reviewed: 2026-03-22
status: canonical
---

# MVP and full project plan

This document answers: **what to build**, **what to test**, and **what to get** (infra, credentials, approvals). It aligns with [ARCHITECTURE.md](./ARCHITECTURE.md), [GOVERNANCE.md](./GOVERNANCE.md), [STATUS.md](./STATUS.md), and [2GIS_STRATEGY.md](./2GIS_STRATEGY.md).

---

## 1. MVP definition (recommended narrow slice)

**Goal:** A single tenant (or internal) user can **discover KZ businesses from 2GIS in the browser**, **see them in the dashboard**, **export or hand off a shortlist**, and **trust that runs are auditable** — without depending on the **paid 2GIS Catalog API**.

| In MVP | Out of MVP (defer) |
|--------|---------------------|
| 2GIS browser scraper (current DOM path; optional later: in-session response intercept) | Official `catalog.api.2gis.*` product dependency |
| Dashboard: trigger scrape, list/filter leads, lead detail, scrape run history | Full multi-tenant billing hardening beyond minimal Stripe |
| API: companies list + scraper trigger + scraper runs | All premium sources (hh.kz, OLX, …) |
| Postgres schema as in `packages/db/src/schema.ts` (locked changes per governance) | `staging_leads` / promotion pipeline unless explicitly rescoped |
| One environment: staging + prod | Perfect parity with legacy `supabase/migrations/*` until reconciled |

**MVP success criteria (measurable):**

1. From dashboard, operator starts a 2GIS job for ≥1 city + category; job completes or fails with row in `scraper_runs` and visible error text.
2. New/updated rows appear in `leads` / `contacts` and are visible in the UI without manual SQL.
3. `npm run build` passes in CI for all workspaces you declare in scope for MVP.
4. Auth (or VPN / IP allowlist) protects API in non-dev environments.

---

## 2. What needs to be built (detailed)

### 2.1 Already in repo (treat as MVP baseline, not “to build”)

- Monorepo, `@leadiya/db` (schema + `db` + `leadRepository` + foundation types), `@leadiya/scrapers` (`twogis`, enrichment helpers, goszakup, stat), `@leadiya/logic`, API routes (companies, scrapers, stripe), dashboard shell + discovery + leads + 2GIS runs sidebar, workers skeleton, extension WXT build.

### 2.2 MVP gaps to close (prioritized backlog)

**A. Product & API**

| ID | Item | Detail |
|----|------|--------|
| MVP-A1 | **Re-enable auth + quota middleware** | `apps/api/src/server.ts` — wire `authMiddleware` / `quotaMiddleware` for non-local; document how dashboard obtains token or session. |
| MVP-A2 | **Scraper job contract** | Today `POST /api/scrapers/2gis` returns 202 with no job id tied to `scraper_runs` in the response body. Return `runId` after insert (or poll-friendly id) so UI can correlate. |
| MVP-A3 | **Rate limiting / single-flight** | Prevent overlapping 2GIS runs from one operator (queue or reject with clear error). |
| MVP-A4 | **Companies API hardening** | Pagination defaults, max limit, consistent filters with UI; optional export endpoint (CSV) for MVP if sales needs it. |

**B. 2GIS scraper (browser-only per strategy)**

| ID | Item | Detail |
|----|------|--------|
| MVP-B1 | **Resilience** | Timeouts, structured logging, screenshot-on-failure (optional flag), clearer `scraper_runs.error` messages. |
| MVP-B2 | **Optional: response intercept** | `page.on('response')` for items JSON to reduce list DOM dependency; keep detail step for phones if needed ([2GIS_STRATEGY.md](./2GIS_STRATEGY.md)). |
| MVP-B3 | **Playwright install path** | Document `npx playwright install chromium` (or bundled browser) for prod workers/API host. |
| MVP-B4 | **Proxy / session** | If 2GIS blocks datacenter IPs, document SMARTPROXY or “run worker on residential/VPN” runbook (config already expects proxy creds in env). |

**C. Database & migrations**

| ID | Item | Detail |
|----|------|--------|
| MVP-C1 | **Drizzle migrations as source of truth** | Generate and apply migrations from `schema.ts`; stop relying on undocumented drift vs `supabase/migrations/*` ([GOVERNANCE.md](./GOVERNANCE.md)). |
| MVP-C2 | **Seed script** | Minimal tenant/user or feature flags if auth requires rows. |

**D. Dashboard**

| ID | Item | Detail |
|----|------|--------|
| MVP-D1 | **Replace `alert()` with in-app toasts** | Discovery start / failure UX. |
| MVP-D2 | **Loading / failed run states** | Sidebar shows running vs stuck (e.g. heartbeat or timeout hint). |
| MVP-D3 | **Settings that are real** | `SettingsView` concurrency — wire to env or API or remove misleading options. |

**E. Workers & queues**

| ID | Item | Detail |
|----|------|--------|
| MVP-E1 | **Redis + worker deploy story** | Document how `REDIS_URL` is set in staging/prod; healthcheck. |
| MVP-E2 | **Discovery worker vs API** | Decide single entry point for 2GIS (API-only vs queue-only) to avoid duplicate runs. |

**F. Extension**

| ID | Item | Detail |
|----|------|--------|
| MVP-F1 | **Define MVP need** | If captcha bypass is MVP-critical, document the `8765` service and E2E path; if not, mark extension as “phase 2” in UI copy. |

**G. Config cleanup (important)**

| ID | Item | Detail |
|----|------|--------|
| MVP-G1 | **`TWOGIS_API_KEY` (Catalog API)** | **Closed:** The key is **not** part of `packages/config` or `.env.example`. The browser scraper does not call the paid Catalog API ([2GIS_STRATEGY.md](./2GIS_STRATEGY.md)). Do **not** add `TWOGIS_API_KEY` to the Zod schema unless a future feature explicitly adopts that API. |

### 2.3 Full project (post-MVP) — build themes

Not exhaustive; ordered roughly by dependency.

1. **More sources** — hh.kz, classifieds, Kompra, etc., each as `packages/scrapers/src/*.ts` + worker + dashboard toggles, same governance for schema.
2. **Enrichment at scale** — queue depth, BIN resolution, dedup across sources, ICP scoring rules in config.
3. **Multi-tenant SaaS** — tenants, RLS or app-level isolation, Stripe plans, usage metering.
4. **Outreach** — `outreach_log` workflows, integrations (WhatsApp/Telegram providers), compliance (consent, opt-out).
5. **Observability** — Sentry workflows, structured logs, dashboards for scrape success rate.
6. **Reconcile or retire** — `promotion.ts`, legacy docs (`scrapers.md` samples), Supabase SQL history.

---

## 3. What needs to be tested

### 3.1 Always-on (CI)

| Test | Command / note |
|------|----------------|
| Typecheck + build all packages | `npm run build` |
| Lint (when configured per package) | `npm run lint` |

### 3.2 MVP manual / staging checklist

| Area | Test |
|------|------|
| DB | Migrations apply clean on empty DB; app starts; `leads` / `contacts` / `scraper_runs` exist per canonical schema. |
| API | `GET /health`; `GET /api/companies` with auth (once enabled); `POST /api/scrapers/2gis` returns expected payload; `GET /api/scrapers/runs?scraper=2gis`. |
| Scraper | Small run: 1 city, 1 category, headless; rows in `leads`; `scraper_runs.status` completed or failed with message; no unhandled process crash. |
| Dashboard | Proxy to API; start job; list updates after refresh/poll; run history matches DB. |
| Workers | Redis ping; enqueue enrichment job (if used) processes without schema errors. |
| Extension | Only if MVP includes it: load unpacked build; websocket status flips when bridge is up. |

### 3.3 Automated tests to add (recommended)

| Layer | Suggestion |
|-------|------------|
| Unit | `LeadFactory.normalizePhone`, `leadRepository.companyNameExists` logic with test DB or mocks. |
| Integration | API routes with test container Postgres + supertest (or Hono test helper). |
| E2E (optional MVP+) | Playwright against dashboard + API in docker-compose. |

### 3.4 Non-functional

| Concern | Test |
|---------|------|
| Security | Auth on all mutating routes; no secrets in client bundle; CORS policy documented. |
| Performance | Companies list with realistic row count (index review on `leads` filters). |
| Recovery | API restart during long scrape — run row should end `failed` or complete; document behavior. |

---

## 4. What needs to be gotten (acquired / provisioned)

### 4.1 Infrastructure

| Item | Purpose |
|------|---------|
| **Postgres** | Primary store (Supabase, RDS, Neon, etc.). |
| **Redis** | BullMQ for workers. |
| **Runtime for API + scraper** | Node host with enough RAM for Chromium; avoid fragile serverless for long Playwright jobs unless using external browser service. |
| **CI** | GitHub Actions / other: `npm ci`, `npm run build`, optional test job. |
| **Secrets store** | Env vars in hosting provider; no `.env` in repo. |

### 4.2 Accounts & credentials (from `packages/config` schema today)

**Note:** Several vars are **heavy for a browser-only MVP** — use staging secrets vault; only set what you use.

| Variable (current required) | Typical source |
|----------------------------|----------------|
| `DATABASE_URL`, `DATABASE_DIRECT_URL` | Postgres provider |
| `SUPABASE_*` | Supabase project |
| `APP_ENCRYPTION_KEY` | Generate 32+ char secret |
| `REDIS_URL` | Redis host |
| `STRIPE_*` | Stripe dashboard (if billing in MVP) |
| `ANTHROPIC_API_KEY` | If AI features used |
| `OLLAMA_URL` | If local LLM |
| `SMARTPROXY_*` | If using proxy for KZ sites |
| `R2_*` | Cloudflare R2 (if file export/storage) |
| `SENTRY_DSN` | Sentry project |
| `RESEND_API_KEY` | Transactional email |

**Not used (by design):** Official **2GIS Catalog HTTP API** / `TWOGIS_API_KEY` — discovery is browser-based only; see [2GIS_STRATEGY.md](./2GIS_STRATEGY.md).

### 4.3 Legal, compliance, operations

| Item | Why |
|------|-----|
| **Terms of use for scraped sites** | 2GIS ToS / robots / CF — legal review for automated access. |
| **Personal data (PII)** | KZ leads contain phones/emails — privacy policy, retention, DPA if B2B SaaS. |
| **Runbook** | Who restarts workers, how to drain queue, how to mark a poison job. |

### 4.4 Team / process

| Item | Why |
|------|-----|
| **Owner for schema changes** | [GOVERNANCE.md](./GOVERNANCE.md) enforcement. |
| **On-call or async owner** | Scraper breakages when 2GIS ships UI changes. |

---

## 5. How this plan stays current

- After each release: update [STATUS.md](./STATUS.md) shipped vs gaps.
- After scope change: adjust sections 1–2 here and bump `last_reviewed`.
- Link from [README.md](./README.md) in this folder (already lists core docs; add this file to the table).

---

## 6. Document index

| Doc | Role |
|-----|------|
| This file | **Plan**: MVP scope, build backlog, test matrix, acquire list. |
| [STATUS.md](./STATUS.md) | **As-built** snapshot vs foundation vision. |
| [GOVERNANCE.md](./GOVERNANCE.md) | **Schema / DB lock** rules. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **One** system diagram and principles. |
| [2GIS_STRATEGY.md](./2GIS_STRATEGY.md) | Browser-only 2GIS constraints. |
| [TESTING.md](../TESTING.md) | Legacy detailed commands (verify against current schema names). |
