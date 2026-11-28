FROM node:24.22.3-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@10.34.8 \
  && mkdir -p /app \
  && chown node:node /app

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
COPY --chown=node:node .npmrc .nvmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages

USER node
RUN pnpm install --frozen-lockfile \
  && pnpm exec turbo run build \
    --filter=@freight/api \
    --filter=@freight/worker \
    --filter=@freight/bot \
    --filter=@freight/web \
    --filter=@freight/admin \
    --concurrency=1
