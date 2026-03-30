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
RUN npm ci --legacy-peer-deps

# ── Build ────────────────────────────────────────────────────
FROM base AS build
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_PUBLIC_API_ORIGIN=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_PUBLIC_API_ORIGIN=$VITE_PUBLIC_API_ORIGIN
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
COPY --from=build /app/dev-ports.json ./dev-ports.json
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

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

# ── Dashboard (static + /api reverse proxy) ─────────────────
FROM nginx:alpine AS dashboard
COPY apps/dashboard/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
