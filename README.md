# Leadiya

B2B lead discovery and enrichment for Kazakhstan: **2GIS** scraping, **government/public** enrichment, a **dashboard**, optional **browser extension**, and optional **WhatsApp** outreach (Baileys).

**Repository:** [github.com/DaurenNope/leadiya](https://github.com/DaurenNope/leadiya)

## Requirements

- **Node.js** 20+
- **PostgreSQL** (local or [Supabase](https://supabase.com/) Postgres)
- **Redis** (BullMQ queues)

## Quick start

```bash
git clone https://github.com/DaurenNope/leadiya.git
cd leadiya

npm install --legacy-peer-deps

cp .env.example .env
# Edit .env: DATABASE_*, REDIS_URL, and either AUTH_BYPASS=true or Supabase keys

npm run build
npm test
npm run dev
```

With `npm run dev`, Turbo starts workspace dev processes (API **:3001**, dashboard **:5173**, etc. per package scripts).

| Local dev tip | |
|---------------|---|
| Auth | Set `AUTH_BYPASS=true` in `.env` to skip JWT on `/api/*` (development only). |
| Supabase egress | For production auth, set `SUPABASE_JWT_SECRET` so the API verifies JWTs locally—see [docs/SUPABASE_FREE_TIER.md](docs/SUPABASE_FREE_TIER.md). |

## Database

```bash
# Apply migrations (from repo root)
npm run db:migrate -w @leadiya/db

# Generate SQL after schema edits
npm run db:generate -w @leadiya/db

# Optional seed
npm run db:seed -w @leadiya/db
```

## Architecture

```
Discovery (2GIS scraper / extension)
    → Postgres (leads)
    → BullMQ enrichment workers
        ├── enrich-twogis
        ├── enrich-website (HTTP + Playwright)
        ├── enrich-stat (stat.gov.kz)
        ├── enrich-uchet (pk.uchet.kz)
        └── enrich-goszakup (goszakup.gov.kz)
    → Dashboard + REST API
```

Optional: **`whatsapp_outreach`** queue + **Baileys** worker when `WHATSAPP_BAILEYS_ENABLED=true` (scan QR on the worker host; auth dir under `apps/workers/data/baileys-auth`, gitignored).

## Workspace layout

| Path | Role |
|------|------|
| `apps/api` | Hono REST API: companies/leads, scrapers, outreach, Stripe hooks |
| `apps/dashboard` | React + Vite + Tailwind UI |
| `apps/workers` | BullMQ workers (discovery, enrichment, optional WhatsApp) |
| `apps/extension` | WXT Chrome extension for 2GIS-assisted capture |
| `packages/db` | Drizzle schema, migrations, `db` client |
| `packages/scrapers` | 2GIS, website enrichment, KZ public API clients |
| `packages/queue` | Shared BullMQ queue names + job types |
| `packages/config` | Zod-validated `env` |
| `packages/logic` | Lead factory, ICP helpers |
| `packages/types` | Shared TS types |

## Environment

Copy **[.env.example](.env.example)** to `.env`. Important groups:

- **Core:** `DATABASE_URL`, `DATABASE_DIRECT_URL`, `REDIS_URL`
- **Auth:** `AUTH_BYPASS` or `SUPABASE_*` + recommended `SUPABASE_JWT_SECRET`
- **WhatsApp:** `WHATSAPP_BAILEYS_ENABLED`, `WHATSAPP_BAILEYS_AUTH_DIR` (optional)
- **Tuning:** `SCRAPER_RUNS_CACHE_MS`, `STAGE2_HTTP_ONLY`, `TWOGIS_CHECKPOINT_DIR`

## Documentation

| Doc | Topic |
|-----|--------|
| [docs/SUPABASE_FREE_TIER.md](docs/SUPABASE_FREE_TIER.md) | Egress-aware Postgres + auth usage |
| [docs/TESTING.md](docs/TESTING.md) | Tests (`vitest`) |
| [docs/progress/STATUS.md](docs/progress/STATUS.md) | Build / status notes |
| [docs/progress/PLAN_MVP_AND_ROADMAP.md](docs/progress/PLAN_MVP_AND_ROADMAP.md) | Roadmap |
| [docs/progress/2GIS_STRATEGY.md](docs/progress/2GIS_STRATEGY.md) | 2GIS scraping |
| [docs/progress/DATA_COLLECTION_100K_PLAN.md](docs/progress/DATA_COLLECTION_100K_PLAN.md) | Scaling data collection |
| [docs/progress/EXTENSION_UTILIZATION.md](docs/progress/EXTENSION_UTILIZATION.md) | Extension vs headless scraper |

## Scripts (repo root)

```bash
npm run build          # turbo build
npm run dev            # turbo dev
npm run lint           # turbo lint / tsc
npm test               # vitest

npx tsx --env-file=.env scripts/evaluate-leads-quality.ts
npx tsx --env-file=.env scripts/broader-2gis-sample.ts
```

More one-off scripts are listed under **One-off data scripts** in older docs or `scripts/`.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs build, lint, and tests on push/PR to `main`.

## Docker

```bash
docker build --target api -t leadiya-api .
docker build --target workers -t leadiya-workers .
docker build --target dashboard -t leadiya-dashboard .
```

## Contributing / git

```bash
git add -A
git commit -m "describe change"
git push origin main
```

Use **`npm install --legacy-peer-deps`** if npm reports peer dependency conflicts (Vite/Tailwind workspace edges).

## License

Add a `LICENSE` file in the repo root when you choose a license; until then, all rights reserved.
