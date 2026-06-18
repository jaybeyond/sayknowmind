FROM node:22-alpine AS base
# Pin pnpm to the version recorded in package.json's "packageManager" field.
# Without this, recent corepack defaults to fetching the latest pnpm at install
# time, which produced ERR_PNPM_LOCKFILE_CONFIG_MISMATCH against our v9 lockfile.
ENV COREPACK_DEFAULT_TO_LATEST=0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.6 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app

# Build-time args — NEXT_PUBLIC_* are baked into client JS at build time, so
# whatever value is set HERE is what every browser will see. CI must pass
# --build-arg NEXT_PUBLIC_APP_URL=https://<your-host> for production builds;
# the defaults track the current production domain so an ad-hoc `docker build`
# without args doesn't silently ship a stale URL.
ARG NEXT_PUBLIC_APP_URL=https://sayknowmind.ypai.click
ARG NEXT_PUBLIC_DEPLOY_MODE=cloud
ARG BETTER_AUTH_SECRET=build-time-placeholder
ARG BETTER_AUTH_URL=https://sayknowmind.ypai.click
# Real-time collab (docs/sheets/mindmaps) — the browser connects to this WS URL.
# NEXT_PUBLIC_* are baked at build time, so this MUST be a build arg (not just a
# runtime env) or the client bundle ships with collab disabled.
ARG NEXT_PUBLIC_COLLAB_WS_URL=wss://sayknowmind.ypai.click/collab
# Auth edition: "saas" = enterprise (login via SayKnowWork), "local" = open
# (built-in email/password). Defaults to "local" (the open/Railway edition) so a
# build with no override never silently delegates auth to SayKnowWork. The
# enterprise build paths (docker-compose, GitLab CI, GitHub CI) pass "saas"
# explicitly. Railway builds this Dockerfile directly with no override, so this
# default is what keeps mind.sayknow.ai on local auth.
ARG NEXT_PUBLIC_AUTH_MODE=local
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_DEPLOY_MODE=$NEXT_PUBLIC_DEPLOY_MODE
ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
ENV NEXT_PUBLIC_COLLAB_WS_URL=$NEXT_PUBLIC_COLLAB_WS_URL
ENV NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Pre-create the file-storage directory the ingest pipeline writes to.
# Without this, the first upload hits `EACCES: permission denied,
# mkdir '/app/uploads'` because the nextjs user can't mkdir at /app.
# A bind/volume mount on /app/uploads at runtime inherits this owner.
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
