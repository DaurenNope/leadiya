# Testing

## Setup

```bash
npm install
```

## Running tests

```bash
# All tests
npx vitest run

# Watch mode
npx vitest

# Specific file
npx vitest run packages/scrapers/src/enrichment.test.ts
```

## Test structure

| File | What it tests |
|------|---------------|
| `packages/scrapers/src/enrichment.test.ts` | Email extraction from HTML, link extraction, phone normalization, email normalization, contact validation |
| `packages/scrapers/src/twogis-checkpoint.test.ts` | Checkpoint file path generation, determinism, default directory |
| `apps/workers/src/enqueue-enrichment.test.ts` | Enrichment fan-out / job enqueue behavior |
| `apps/api/src/server.test.ts` | API routes (health, companies, scrapers wiring) |

**Collection at scale (checkpoints, verification SQL, curl):** [docs/progress/DATA_COLLECTION_100K_PLAN.md](progress/DATA_COLLECTION_100K_PLAN.md).

## Smoke tests

```bash
# Bounded parallel 2GIS run (requires .env, DB, network, Chromium — see script)
npx tsx --env-file=.env scripts/parallel-smoke-2gis.ts

# Stage 2 HTTP extraction (requires network)
npm run test:stage2-http

# Optional: pass a custom URL
STAGE2_TEST_URL=https://example.kz npm run test:stage2-http
```

## Adding tests

Tests live next to their source files as `*.test.ts`. The vitest config at the root picks up anything matching `packages/**/src/**/*.test.ts` or `apps/**/src/**/*.test.ts`.

For tests that need a database, mock the `db` import from `@leadiya/db`. For tests that need Redis/BullMQ, mock the queue imports.
