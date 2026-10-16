# Wedding Invitation Platform

Personal wedding invitation platform for a 2027 wedding.

## Status

Implemented source includes personalized invitations, household RSVP and QR passes, guest messages, OWNER management, CSV/XLSX import, staff authentication/RBAC, transactional check-in, scanner UI, reporting, and public enhancements. OWNER **Event materials** (`/event-content`) now manages persisted parking/rundown drafts, supporting-file uploads, preview, publish and hide. See `docs/PARKING-RUNDOWN-CONTENT.md` for use and the required additive migration; implementation applied it only to QA. Local packaging and all evidence/remaining gates are tracked in `docs/IMPLEMENTATION-PROGRESS.md`. This is local development; production and venue readiness have not been established.

## Applications

CI/CD for GitHub App source deployments to Coolify is prepared in [the deployment runbook](docs/COOLIFY-DEPLOYMENT.md). It covers separate staging/production release branches, CI gates, three application containers, migration ordering, HTTPS/domain setup, and remaining live verification. The mobile invitation uses `invitation-web`.

- `apps/invitation-web`: public wedding invitation frontend.
- `apps/admin-web`: OWNER management and restricted staff frontend.
- `apps/api`: NestJS backend with PostgreSQL and `GET /health`.

## Packages

- `packages/api-client`: generated client from the backend OpenAPI contract.
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

For persistent daily work with hot reload, use the [daily runbook](docs/LOCAL-DAILY-DEVELOPMENT.md). It provides `local:init`, private OWNER setup, `local:up/status/down/recover`, a separate PostgreSQL volume, and ports 3200/3201/4200. Daily configuration never falls back to the working database; destructive verification uses disposable QA databases. See the [verification matrix](docs/LOCAL-DAILY-DEVELOPMENT-VERIFICATION.md) for executed checks and remaining gaps.

The original individual commands remain available:

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

Prisma uses `apps/api/prisma.config.ts`, which loads environment variables with `dotenv/config`, points to `apps/api/prisma/schema.prisma`, stores migrations in `apps/api/prisma/migrations`, and reads the datasource URL from `DATABASE_URL`. Package commands run from `apps/api`, so use an ignored `apps/api/.env` or exported environment variables; a repository-root `.env` alone is not loaded by those commands. API runtime also needs `CREDENTIAL_SECRET`, `ADMIN_ORIGIN` and `PUBLIC_INVITATION_BASE_URL`. Frontend upstream variables belong in each frontend's ignored local env file (see `.env.example` for keys).

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

API integration tests delete fixture tables. Use a separate migrated test database and explicitly set `INVITATION_DATABASE_TESTS=1` before `pnpm test`; the API test guard rejects the development database. Real workflow browser tests also require `INVITATION_WORKFLOW_TEST=1`. See `docs/LOCAL-OPERATIONS.md` and the verification ledger.

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
