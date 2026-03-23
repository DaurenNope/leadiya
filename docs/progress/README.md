---
title: Progress & canonical docs index
last_reviewed: 2026-03-21
status: canonical
---

# Progress documentation

**Single place** for how the repo is supposed to work, what shipped, and what is in flight. Other markdown (e.g. `scrapers.md`, `FOUNDATION_BUILD_PLAN.md`) is **historical or supplementary** unless linked here.

## Read in this order

| File | Purpose |
|------|---------|
| [GOVERNANCE.md](./GOVERNANCE.md) | **Locked schema + DB** — what may change and how. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | **One normalized system map** — apps, packages, data flow, principles. |
| [STATUS.md](./STATUS.md) | **Where we stand vs plan** — shipped, fragile, backlog. |
| [2GIS_STRATEGY.md](./2GIS_STRATEGY.md) | **Browser-only 2GIS** — DOM today; optional intercept; **no paid Catalog API**. |
| [PLAN_MVP_AND_ROADMAP.md](./PLAN_MVP_AND_ROADMAP.md) | **MVP + full roadmap** — what to build, test, and acquire. |

## Conventions

- **Frontmatter** on every file here: `title`, `last_reviewed`, `status` (`canonical` | `draft` | `deprecated`).
- **Schema changes** follow [GOVERNANCE.md](./GOVERNANCE.md) — not silent edits to `schema.ts`.
- **Behavior changes** (scrapers, API contracts): update [STATUS.md](./STATUS.md) and the relevant strategy/architecture file in the **same** change.

## Quick links

- Canonical schema: `packages/db/src/schema.ts`
- 2GIS scraper: `packages/scrapers/src/twogis.ts`
- Dashboard: `apps/dashboard/`
- API: `apps/api/`
