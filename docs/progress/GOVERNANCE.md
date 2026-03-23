---
title: Schema, database, and change governance
last_reviewed: 2026-03-21
status: canonical
---

# Governance: locked DB contract

These rules exist so the team does not drift across multiple “sources of truth” or change persistence casually.

## Single schema authority

| Rule | Detail |
|------|--------|
| **Canonical application schema** | [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts) — Drizzle table definitions used by API, scrapers, workers, and `leadRepository`. |
| **Locked** | Treat this file as a **versioned contract**. No drive-by column renames or type changes in unrelated PRs. |
| **Not canonical until adopted** | Files under `supabase/migrations/` are **legacy / historical** until an explicit project reconciles them with Drizzle and documents the cutover in [STATUS.md](./STATUS.md). Do not assume they match production. |

## How schema changes are allowed to happen

1. **Proposal** — Short note in a PR description or a one-pager: why the change, backfill/migration plan, impact on scrapers/API/dashboard.
2. **Drizzle migration** — Generate and commit the migration that matches `schema.ts` (team standard: `drizzle-kit` workflow when in use; if not wired yet, SQL migration reviewed like code).
3. **Docs** — Update [STATUS.md](./STATUS.md) and, if structure changes, [ARCHITECTURE.md](./ARCHITECTURE.md).
4. **Consumers** — Update every reader/writer: scrapers, API routes, workers, dashboard types if exposed.

Until steps 1–4 are done, **the schema is considered frozen** for that change.

## Database operations

- **No ad-hoc production DDL** outside the migration process above.
- **Application code** must not rely on tables or columns that are not in the canonical Drizzle schema.
- **Environment**: `DATABASE_URL` / `DATABASE_DIRECT_URL` come from `@leadiya/config`; secrets stay out of the repo.

## Architecture docs stay aligned

Any change that crosses package boundaries (e.g. scraper writing a new table) must update:

- [ARCHITECTURE.md](./ARCHITECTURE.md) (data flow)
- [STATUS.md](./STATUS.md) (shipped vs in progress)

If this governance file itself changes, bump `last_reviewed` and record the decision in [STATUS.md](./STATUS.md) under a short “Governance” bullet if it is substantive.
