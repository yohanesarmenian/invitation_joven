FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536
# Prisma generation needs a URL syntactically; no database connection is made.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/admin-web/package.json ./apps/admin-web/package.json
COPY apps/invitation-web/package.json ./apps/invitation-web/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm db:generate
ARG APP=api
# Non-secret build-time rewrite target. Rebuild admin-web when this changes.
ARG ADMIN_API_INTERNAL_BASE_URL=http://api:4000
ENV ADMIN_API_INTERNAL_BASE_URL=${ADMIN_API_INTERNAL_BASE_URL}
RUN case "$APP" in api|admin-web|invitation-web) ;; *) echo "Unsupported APP" >&2; exit 1 ;; esac
RUN if [ "$APP" = api ]; then pnpm --filter api build; else pnpm --filter "$APP" exec next build --webpack; fi

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
ARG APP=api
ARG SOURCE_COMMIT=unknown
ENV APP=${APP}
LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}
# Preserve pnpm workspace symlinks. Raw photo sources, private data, and docs
# are excluded by .dockerignore; public photo exports remain in the image.
COPY --from=build --chown=node:node /workspace /workspace
COPY --chown=node:node ops/deploy/start.sh ops/deploy/healthcheck.mjs ops/deploy/bootstrap-owner.mjs ops/deploy/migrate.mjs ./ops/deploy/
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=10 CMD ["node", "ops/deploy/healthcheck.mjs"]
CMD ["sh", "ops/deploy/start.sh"]
