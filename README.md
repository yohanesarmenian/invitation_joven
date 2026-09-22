# Wedding Invitation Platform

Personal wedding invitation platform for a 2027 wedding.

## Status

This repository currently contains the Phase 2 engineering foundation: monorepo tooling, app skeletons, PostgreSQL local development, Prisma schema/migrations, and API database health infrastructure. Product features such as invitation rendering, RSVP, QR, check-in, imports, reporting, and authentication are planned for later phases and are not implemented yet.

## Applications

- `apps/invitation-web`: planned public wedding invitation frontend.
- `apps/admin-web`: planned OWNER admin frontend.
- `apps/api`: NestJS backend API with database infrastructure and `GET /health`.

## Packages

- `packages/api-client`: future generated client from the backend OpenAPI contract.
- `packages/shared-types`: future shared non-API-contract TypeScript primitives.
- `packages/eslint-config`: shared ESLint configuration helpers.
- `packages/tsconfig`: shared TypeScript configuration.

## Prerequisites

- Node.js
- pnpm, managed through Corepack using the version pinned in `package.json`

## Install

```bash
pnpm install
```

## Development

```bash
docker compose up -d postgres
pnpm --filter invitation-web dev
pnpm --filter admin-web dev
pnpm --filter api start:dev
```

Default local ports:

- invitation-web: `3000`
- admin-web: `3001`
- api: `4000`

## Database

Local PostgreSQL runs through Docker Compose using the major-pinned `postgres:18` image and a named persistent volume. Copy `.env.example` to `.env` for local development values, or export `DATABASE_URL` in the shell before running database/API commands.

Prisma uses `apps/api/prisma.config.ts`, which loads environment variables with `dotenv/config`, points to `apps/api/prisma/schema.prisma`, stores migrations in `apps/api/prisma/migrations`, and reads the datasource URL from `DATABASE_URL`.

Prisma Client is generated with `provider = "prisma-client"` into `apps/api/src/generated/prisma` using ESM module format. Generated Prisma Client source is ignored by Git and regenerated before typecheck, tests, builds, and CI validation.

Useful commands:

```bash
pnpm db:generate
pnpm db:validate
pnpm db:migrate
pnpm db:migrate:deploy
pnpm db:status
```

## Validation

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:status
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Source of Truth

Locked project documentation lives in `docs/`. Implementation work must follow those documents and the phase boundaries in `docs/IMPLEMENTATION-ROADMAP.md`.
