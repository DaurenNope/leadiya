# ── Base ─────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/queue/package.json packages/queue/
COPY packages/logic/package.json packages/logic/
COPY packages/scrapers/package.json packages/scrapers/
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci

# ── Build ────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/*/node_modules || true
COPY . .
RUN npx turbo run build

# ── API ──────────────────────────────────────────────────────
FROM base AS api
ENV NODE_ENV=production PORT=3001
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/package.json ./
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]

# ── Workers ──────────────────────────────────────────────────
FROM base AS workers
ENV NODE_ENV=production
# Playwright browsers for website enrichment fallback
RUN npx playwright install --with-deps chromium 2>/dev/null || true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/workers ./apps/workers
COPY --from=build /app/package.json ./
CMD ["node", "apps/workers/dist/main.js"]

# ── Dashboard (static build) ────────────────────────────────
FROM nginx:alpine AS dashboard
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
