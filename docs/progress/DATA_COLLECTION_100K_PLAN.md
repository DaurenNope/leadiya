---
title: Data collection to 100k leads — agent playbook (checkpoints, tests, verification)
last_reviewed: 2026-03-22
status: canonical
audience: humans + coding agents
---

# Data collection to ~100k leads — agent playbook

This document is the **execution guide** for reaching large-scale 2GIS collection: **checkpoints** (gates), **automated tests**, and **verification** steps. It subsumes the overlap rules and pipeline overview; agents should **execute checkpoints in order** unless a phase is explicitly skipped.

**How agents should use this file**

1. Work **phase by phase**; do not skip **CP-0.x** unless the environment cannot run browsers/DB.
2. For each checkpoint: run **all** listed **Automated checks**; record output; then run **Manual / integration** only where automation is impossible.
3. A checkpoint **passes** only when **every** Pass criterion is satisfied.
4. On failure: follow **On failure**; do not proceed to the next checkpoint until resolved or risk is documented.

**Related code and docs**

| Area | Location |
|------|----------|
| 2GIS scraper | `packages/scrapers/src/twogis.ts` |
| Checkpoints | `packages/scrapers/src/twogis-checkpoint.ts` |
| API scraper + re-enrich | `apps/api/src/routes/scrapers.ts` |
| Extension bulk + enrichment enqueue | `apps/api/src/routes/leads.ts` |
| Enrichment fan-out | `apps/workers/src/enqueue-enrichment.ts`, `apps/workers/src/workers/enrichment.worker.ts` |
| Parallel smoke (bounded) | `scripts/parallel-smoke-2gis.ts` |
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md), [2GIS_STRATEGY.md](./2GIS_STRATEGY.md) |
| General testing | [../TESTING.md](../TESTING.md) |

---

## Table of contents

1. [Target definition (freeze before scale)](#1-target-definition-freeze-before-scale)
2. [Overlap and idempotency (reference)](#2-overlap-and-idempotency-reference)
3. [Automated test matrix](#3-automated-test-matrix)
4. [Verification recipes](#4-verification-recipes)
5. [Phase P0 — Environment & reliability](#phase-p0--environment--reliability)
6. [Phase P1 — Parallelism & checkpoints](#phase-p1--parallelism--checkpoints)
7. [Phase P2 — Partitioning toward 100k](#phase-p2--partitioning-toward-100k)
8. [Phase P3 — Enrichment at volume](#phase-p3--enrichment-at-volume)
9. [Phase P4 — Data quality & reporting](#phase-p4--data-quality--reporting)
10. [Stuck-state runbook](#10-stuck-state-runbook)

---

## 1. Target definition (freeze before scale)

**Agent action:** Confirm with the human operator or write defaults into a single config source (e.g. env + README table). Without this, “100k” is ambiguous.

| Field | Record here | Example |
|-------|-------------|---------|
| `TARGET_LEADS` | | `100000` |
| `LEAD_DEFINITION` | branch vs org vs “one row per 2GIS card” | |
| `CITY_LIST` | frozen for the campaign | from `twogis.ts` / dashboard |
| `CATEGORY_LIST` | frozen | from `twogis.ts` / dashboard |
| `PRIMARY_DISCOVERY` | `api` \| `discovery_queue` \| `extension_only` | pick **one** for production |
| `PROXY_POLICY` | when `SMARTPROXY_*` is required | |
| `CHECKPOINT_DIR` | absolute path on runner | `TWOGIS_CHECKPOINT_DIR` |

---

## 2. Overlap and idempotency (reference)

### Inside one `run2GisScraper` run

| Concern | Handled by |
|---------|------------|
| Duplicate (city, category) in same run | Crawlee `uniqueKey: 2gis\|{city}\|{category}` |
| Checkpoint file clashes | Separate file per slice — hash in `checkpointFilePath()` |
| Duplicate firms | Session dedup + DB (`sourceUrl`, `leadExists`, deterministic `id`, upsert) — **not** perfect for name variants |

### Across runs / entry points (gaps)

| Gap | Mitigation for agents |
|-----|------------------------|
| Two API instances | Treat single-flight as **best-effort**; prefer one API replica for scraper triggers or add distributed lock later |
| API scrape + `discovery` worker | **Do not** run both against the same matrix without partitioning |
| Extension + headless | Rely on DB dedup; expect some duplicates on name/URL variants |

### Pipeline (Stage 1 → Stage 2)

```text
2GIS (headless API / discovery worker / extension)
  → Postgres: leads, contacts
  → BullMQ queue `enrichment` (API on 2GIS complete, extension bulk, re-enrich, companies bulk)
  → Worker fans out: enrich-twogis (name search on 2GIS.kz for non-2GIS leads, once per lead), enrich-website, enrich-stat, enrich-uchet, enrich-goszakup
  → Postgres: enrichment fields, last_enriched_at, enrichment_sources (includes `twogisSearch`)
```

**Extension:** `POST /api/leads/bulk` returns `enrichmentQueued` when new IDs were batched to `enrichment`. **Requires Redis + workers.**

---

## 3. Automated test matrix

Run from **repository root** unless noted.

| ID | Command | Expect |
|----|---------|--------|
| **T-UNIT-1** | `npx vitest run packages/scrapers/src/twogis-checkpoint.test.ts` | All pass |
| **T-UNIT-2** | `npx vitest run packages/scrapers/src/enrichment.test.ts` | All pass |
| **T-UNIT-3** | `npx vitest run apps/workers/src/enqueue-enrichment.test.ts` | All pass |
| **T-UNIT-4** | `npx vitest run apps/api/src/server.test.ts` | All pass |
| **T-ALL** | `npx vitest run` | All pass (may be slower) |
| **T-BUILD** | `npm run build` | Exit 0 |
| **T-SMOKE-PARALLEL** | `npx tsx --env-file=.env scripts/parallel-smoke-2gis.ts` | Completes; logs show 3 Crawlee requests finished; **requires** `DATABASE_URL`, Playwright Chromium, network. Uses `skipProxy: true` in script — see script header |

**Agent rule:** Before any production deploy or large scrape, run **T-UNIT-1** through **T-UNIT-4** and **T-BUILD** at minimum.

---

## 4. Verification recipes

### 4.1 Postgres (ad-hoc)

Use `psql`, Drizzle studio, or Supabase SQL editor. Replace placeholders.

**Lead count**

```sql
SELECT COUNT(*) AS leads_total FROM leads;
```

**Recent collection by source**

```sql
SELECT source, COUNT(*) AS n
FROM leads
GROUP BY source
ORDER BY n DESC;
```

**Scraper runs health** (`status` must be `running` \| `done` \| `error` \| `cancelled` per schema)

```sql
SELECT id, scraper, status, results_count, error, started_at, completed_at
FROM scraper_runs
ORDER BY started_at DESC
LIMIT 20;
```

**Stuck running runs** (older than threshold; adjust interval)

```sql
SELECT id, scraper, status, started_at
FROM scraper_runs
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '6 hours';
```

**Enrichment coverage (rough)**

```sql
SELECT
  COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL) AS enriched,
  COUNT(*) AS total
FROM leads;
```

### 4.2 API (local, `AUTH_BYPASS=true`)

**Health** (root path, not under `/api`)

```bash
curl -sS http://localhost:3001/health
```

**List scraper runs**

```bash
curl -sS http://localhost:3001/api/scrapers/runs?limit=5 | jq .
```

**Trigger small 2GIS job** (example body — adjust cities/categories)

```bash
curl -sS -X POST http://localhost:3001/api/scrapers/2gis \
  -H 'Content-Type: application/json' \
  -d '{"cities":["Алматы"],"categories":["IT-компании"],"headless":true,"maxConcurrency":1,"resumeCheckpoint":true}'
```

**Extension bulk shape** (validation only; empty DB preferred for test IDs)

```bash
curl -sS -X POST http://localhost:3001/api/leads/bulk \
  -H 'Content-Type: application/json' \
  -d '{"leads":[{"name":"Agent Test Lead","city":"Алматы","phones":[],"emails":[]}]}' | jq .
```

Expect `inserted` / `skipped` / `enrichmentQueued` in response when inserts occurred.

### 4.3 Redis / workers

**Redis ping** (if `redis-cli` available)

```bash
redis-cli -u "$REDIS_URL" ping
```

**Workers process:** user should see logs like `Leadiya workers started`, `[enrichment] Batch:`, `[enrich:website]` when jobs exist.

**Agent check:** With API + workers + Redis up, after a successful 2GIS run with new leads, **within minutes** `last_enriched_at` or `enrichment_sources` should move for some leads (subject to website/BIN availability).

---

## Phase P0 — Environment & reliability

**Goal:** One machine can complete a **small** headless scrape, persist data, and record `scraper_runs` correctly.

### CP-0.1 — Repo builds and unit tests

| Field | Content |
|-------|---------|
| **Preconditions** | Node 20+, `npm install` done |
| **Automated** | **T-BUILD**, **T-UNIT-1** … **T-UNIT-4** |
| **Pass** | All commands exit 0 |
| **On failure** | Fix compile/test failures before any scrape work |

### CP-0.2 — Playwright browser available

| Field | Content |
|-------|---------|
| **Preconditions** | CP-0.1 pass |
| **Automated** | `npx playwright install chromium` (if not already) |
| **Manual** | Run **T-SMOKE-PARALLEL** OR a single-city manual scrape |
| **Pass** | No “executable doesn’t exist” / browser launch errors |
| **On failure** | Document OS deps; re-run install |

### CP-0.3 — Database and env

| Field | Content |
|-------|---------|
| **Preconditions** | `.env` with valid `DATABASE_URL` (and `REDIS_URL` if testing enrichment) |
| **Automated** | App starts: `npm run dev` or run API workspace per README |
| **Verification** | Run **§4.1** `leads_total` query (may be 0) |
| **Pass** | Query succeeds; schema has `leads`, `scraper_runs` |
| **On failure** | Align schema (migrations / `drizzle-kit` per project docs) |

### CP-0.4 — Single-slice scrape (operator)

| Field | Content |
|-------|---------|
| **Preconditions** | API running; CP-0.2–0.3 pass |
| **Action** | `POST /api/scrapers/2gis` with **one** city and **one** category, `maxConcurrency: 1`, `resumeCheckpoint: true` |
| **Verification** | **§4.1** new row in `scraper_runs` ending `done` or `error` with non-null `completed_at` for terminal states; lead count non-decreasing on success |
| **Pass** | Run completes without orphan `running` (see **§10** if stuck) |
| **On failure** | Capture `scraper_runs.error`; check captcha/proxy; see [2GIS_STRATEGY.md](./2GIS_STRATEGY.md) |

---

## Phase P1 — Parallelism & checkpoints

**Goal:** Multiple city×category slices in **one** run do not corrupt checkpoints; parallelism is observable.

### CP-1.1 — Checkpoint tests

| Field | Content |
|-------|---------|
| **Automated** | **T-UNIT-1** (`twogis-checkpoint.test.ts`) |
| **Pass** | Green |

### CP-1.2 — Bounded parallel smoke

| Field | Content |
|-------|---------|
| **Preconditions** | CP-0.3 pass; network OK |
| **Automated** | **T-SMOKE-PARALLEL** (`scripts/parallel-smoke-2gis.ts`) |
| **Verify in logs** | Crawlee: `Total 3 requests: 3 succeeded` (or expected count); lines `[limits]` per slice; **no** single checkpoint file errors |
| **Pass** | Script exits 0; DB reflects expected small change |
| **On failure** | If proxy timeouts: script uses `skipProxy: true` — for production proxy runs, increase timeouts or fix proxy separately |

### CP-1.3 — Checkpoint resume (manual)

| Field | Content |
|-------|---------|
| **Action** | Start a multi-page slice (or use limits removed in a dev branch only), interrupt process mid-run (SIGINT), restart **same** cities/categories with `resumeCheckpoint: true` |
| **Pass** | Log shows `[checkpoint] Resuming`; no duplicate writes for same `source_url` beyond dedup rules |
| **Record** | Note `TWOGIS_CHECKPOINT_DIR` path used |

---

## Phase P2 — Partitioning toward 100k

**Goal:** Throughput and operations support **many** slices without double work.

### CP-2.1 — Choose PRIMARY_DISCOVERY

| Field | Content |
|-------|---------|
| **Decision** | Document in §1 table: `api` **or** `discovery_queue` |
| **Pass** | The non-primary path is disabled in prod **or** matrix-partitioned so no overlap |
| **Verify** | No concurrent duplicate matrix from two entry points (grep `run2GisScraper` callers) |

### CP-2.2 — Measure baseline throughput

| Field | Content |
|-------|---------|
| **Action** | Run one full slice (or fixed page count); record wall time and `results_count` / lead delta |
| **Pass** | Documented **leads/hour** (or leads/slice) in run log or wiki |
| **Formula hint** | `delta_leads / (wall_seconds/3600)` |

### CP-2.3 — Scale-out plan

| Field | Content |
|-------|---------|
| **Action** | Partition city×category matrix across runners **disjointly** OR raise `maxConcurrency` with proxy policy |
| **Pass** | Written partition table (who runs which cities) exists |
| **Verify** | No two runners claim same (city, category) simultaneously |

### CP-2.4 — API single-flight awareness

| Field | Content |
|-------|---------|
| **Verify** | Second `POST /api/scrapers/2gis` while `running` returns `existing: true` (see `scrapers.ts`) |
| **Pass** | Documented for operators; known limitation for multi-API documented in §2 |

---

## Phase P3 — Enrichment at volume

**Goal:** Stage 2 keeps up with Stage 1; backlog is visible.

### CP-3.1 — Workers + Redis

| Field | Content |
|-------|---------|
| **Automated** | **T-UNIT-3** |
| **Manual** | Start `apps/workers`; **§4.3** Redis ping |
| **Pass** | Worker logs show consumers registered |

### CP-3.2 — Chaining verification

| Field | Content |
|-------|---------|
| **Action** | After CP-0.4 or extension bulk with **new** leads |
| **Verify** | **§4.1** enriched count increases over time; sample lead has `enrichment_sources` or `last_enriched_at` |
| **Pass** | Within agreed SLA window (define in §1) |
| **On failure** | Check BullMQ dashboard / Redis keys; worker errors |

### CP-3.3 — Re-enrich path

| Field | Content |
|-------|---------|
| **Action** | `POST /api/scrapers/re-enrich` (dashboard button or curl) |
| **Pass** | 202 + `count` JSON; jobs processed without worker crash |

---

## Phase P4 — Data quality & reporting

**Goal:** 100k rows are **usable** for sales, not just numerous.

### CP-4.1 — Field fill rates

| Field | Content |
|-------|---------|
| **SQL** | Add queries for `% non-null phone` (via `contacts`), `% website`, `% bin` |
| **Pass** | Thresholds agreed with stakeholder |

### CP-4.2 — Duplicate audit

| Field | Content |
|-------|---------|
| **SQL** | e.g. duplicate `source_url`, duplicate `(lower(trim(name)), lower(trim(city)))` |
| **Pass** | Count below threshold or merge backlog created |

### CP-4.3 — Export / handoff

| Field | Content |
|-------|---------|
| **Verify** | Dashboard or `GET` export path documented in README works on sample |
| **Pass** | Sales can consume CSV or API page |

---

## 10. Stuck-state runbook

| Symptom | Checks | Action |
|---------|--------|--------|
| `scraper_runs.status = 'running'` forever | **§4.1** stuck query | Mark `error` manually with reason after confirming process dead; investigate orphan process |
| Leads grow but never enrich | Workers down, Redis down | Start workers; **§4.3** |
| Captcha loop | Logs in scraper | Lower concurrency; enable proxy; use extension |
| Checkpoint stale after URL change | Log `[checkpoint] Search URL changed` | Expected clear; re-run |
| High duplicate inserts | **CP-4.2** | Tune dedup; normalize names |

---

## Appendix A — Quick agent checklist (copy/paste)

```
[ ] CP-0.1  npm run build && vitest on checkpoint, enrichment, enqueue-enrichment, server tests
[ ] CP-0.2  playwright chromium + smoke OR small scrape
[ ] CP-0.3  DB + env
[ ] CP-0.4  single POST /api/scrapers/2gis
[ ] CP-1.1  twogis-checkpoint tests
[ ] CP-1.2  scripts/parallel-smoke-2gis.ts
[ ] CP-1.3  resume interrupt test (optional)
[ ] CP-2.1  document PRIMARY_DISCOVERY
[ ] CP-2.2  measure leads/hour
[ ] CP-2.3  partition matrix
[ ] CP-3.1–3.3  workers + chaining + re-enrich
[ ] CP-4.1–4.3  quality + export
```

---

## Appendix B — Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [2GIS_STRATEGY.md](./2GIS_STRATEGY.md)
- [PLAN_MVP_AND_ROADMAP.md](./PLAN_MVP_AND_ROADMAP.md)
- [../TESTING.md](../TESTING.md)
