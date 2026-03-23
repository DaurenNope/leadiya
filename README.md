# Leadiya monorepo

B2B lead discovery and enrichment platform for Kazakhstan. Scrapes businesses from 2GIS, enriches from government/public APIs, and provides a dashboard for managing the pipeline.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy env and fill in required values
cp .env.example .env

# 3. Build all packages
npm run build

# 4. Run tests
npm test

# 5. Run linter
npm run lint

# 6. Start development servers (API on :3001, Dashboard on :5173)
npm run dev
```

Requires: Node 20+, PostgreSQL, Redis. Set `AUTH_BYPASS=true` in `.env` for local development without Supabase auth.

### Database setup

```bash
# Push schema to database (dev)
npm run db:migrate -w @leadiya/db

# Generate migration SQL from schema changes
npm run db:generate -w @leadiya/db

# Seed sample data
npm run db:seed -w @leadiya/db
```

## Architecture

```
Discovery (2GIS scraper)
    ↓ writes leads to Postgres
    ↓ returns new lead IDs
Enrichment Pipeline (BullMQ)
    ├── enrich-twogis   (2GIS name search for non-2GIS leads, once per lead)
    ├── enrich-website  (HTTP + Playwright)
    ├── enrich-stat     (stat.gov.kz)
    ├── enrich-uchet    (pk.uchet.kz)
    └── enrich-goszakup (goszakup.gov.kz)
```

## Packages

| Package | Description |
|---------|-------------|
| `apps/api` | Hono REST API with auth, CSV export, scraper management |
| `apps/dashboard` | React + Vite + Tailwind dashboard |
| `apps/workers` | BullMQ workers for discovery and enrichment |
| `apps/extension` | WXT browser extension for 2GIS |
| `packages/db` | Drizzle ORM schema, migrations, and database access |
| `packages/scrapers` | 2GIS scraper, website enrichment, government API clients |
| `packages/config` | Zod-validated environment configuration |
| `packages/logic` | Lead factory, deduplication, ICP scoring |
| `packages/types` | Shared TypeScript types |

## One-off data scripts

| Script | Purpose |
|--------|---------|
| `scripts/broader-2gis-sample.ts` | Bounded multi-city/category scrape (edit `CITIES` / `CATEGORIES` / `limits` inside the file) |
| `scripts/evaluate-leads-quality.ts` | Read-only DB report: counts, fill rates, recent 2GIS samples (`--hours=24`) |
| `scripts/parallel-smoke-2gis.ts` | Quick parallel smoke test (3 slices, tiny limits) |
| `scripts/scrape-education-hei.ts` | Universities / institutes / colleges / business schools across KZ cities (bounded limits; checkpoints on) |

```bash
npx tsx --env-file=.env scripts/evaluate-leads-quality.ts
npx tsx --env-file=.env scripts/broader-2gis-sample.ts
```

## Documentation

- **[docs/progress/STATUS.md](docs/progress/STATUS.md)** — current build status
- **[docs/progress/PLAN_MVP_AND_ROADMAP.md](docs/progress/PLAN_MVP_AND_ROADMAP.md)** — MVP plan and roadmap
- **[docs/progress/2GIS_STRATEGY.md](docs/progress/2GIS_STRATEGY.md)** — scraping approach
- **[docs/progress/DATA_COLLECTION_100K_PLAN.md](docs/progress/DATA_COLLECTION_100K_PLAN.md)** — overlap rules, extension vs dashboard, scaling to ~100k leads
- **[docs/progress/EXTENSION_UTILIZATION.md](docs/progress/EXTENSION_UTILIZATION.md)** — when to use the 2GIS browser extension vs API scraper
- **[docs/TESTING.md](docs/TESTING.md)** — test setup and structure
- **[.env.example](.env.example)** — all environment variables

## CI

GitHub Actions runs on push to `main` and on PRs: build, lint, and test.

## Docker

```bash
# API
docker build --target api -t leadiya-api .

# Workers
docker build --target workers -t leadiya-workers .

# Dashboard (nginx)
docker build --target dashboard -t leadiya-dashboard .
```
