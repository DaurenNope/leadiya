FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy source and configs
COPY tsconfig.json ./
COPY src/ ./src/
COPY config/ ./config/
COPY public/ ./public/

# Build TypeScript
RUN npx tsc

# Cloud Run uses PORT env var (defaults to 8080)
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Start the server
CMD ["node", "dist/server.js"]
