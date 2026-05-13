# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# This package lives inside a pnpm monorepo — no per-package
# package-lock.json exists. `npm install` resolves from package.json
# directly and writes a lockfile we reuse in the runner stage.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

# ── Stage 2: Production ────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist/ dist/

EXPOSE 8082
CMD ["node", "dist/index.js"]
