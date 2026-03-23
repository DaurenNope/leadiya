# Supabase free tier and egress

Supabase bills **egress** (data leaving their network). With **hosted Postgres**, every row your API or workers read over `DATABASE_URL` / `DATABASE_DIRECT_URL` counts toward that quota—not only REST or Auth traffic.

This repo is already shaped to reduce avoidable transfer:

## 1. Auth: local JWT verification

`apps/api/src/middleware/auth.ts` uses **`SUPABASE_JWT_SECRET`** (Dashboard → **Project Settings** → **API** → **JWT Secret**) to verify Bearer tokens with [`jose`](https://github.com/panva/jose), **without** calling `supabase.auth.getUser()` on each request.

- Set `SUPABASE_JWT_SECRET` in production whenever you use real auth (`AUTH_BYPASS` not `true`).
- If it is unset, the API falls back to `getUser()` (one HTTP round trip to Supabase per authenticated request).

## 2. Database reads: omit huge columns

`leads.raw_data` can be very large (full scraper payloads). List, detail, and export routes use column picks in `apps/api/src/lib/lead-select.ts` so **`raw_data` is not read** for normal API traffic. Inspect raw blobs with SQL Studio or a one-off script if needed.

## 3. Request caps

- Company list: **max 100** rows per request, **max offset 25 000** (see `apps/api/src/routes/companies.ts`).
- Export: **max 3 000** rows per export, and only columns needed for CSV/JSON (no large JSONB blobs).

## 4. Polling and caching

- Dashboard scraper run list polls every **45s** (was 15s) to cut repeated reads.
- `GET /api/scrapers/runs` is cached in-process for **`SCRAPER_RUNS_CACHE_MS`** (default **8000** ms; set `0` to disable).

## 5. What still uses bandwidth

- **Workers**, **migrations**, and **Drizzle** using your Supabase connection string still transfer query results from Supabase.
- Large batch jobs (discovery, enrichment) can move a lot of data; run heavy jobs against a **local Postgres** clone when developing, or throttle concurrency.

## 6. Operational checklist

- [ ] Set `SUPABASE_JWT_SECRET` wherever `AUTH_BYPASS` is not used.
- [ ] Avoid raising list/export caps without a reason.
- [ ] Do not point scrapers at production DB from a dev laptop all day; use a dev project or local DB when iterating.
- [ ] Watch **Supabase Dashboard → Settings → Usage** weekly.

For limits and pricing, use the [official Supabase pricing / usage docs](https://supabase.com/pricing).
