# Wedding Invitation Platform

Personal wedding invitation platform for a 2027 wedding.

## Status

This repository currently contains the Phase 1 engineering foundation only. Product features such as invitation rendering, RSVP, QR, check-in, imports, reporting, authentication, and database persistence are planned for later phases and are not implemented yet.

## Applications

- `apps/invitation-web`: planned public wedding invitation frontend.
- `apps/admin-web`: planned OWNER admin frontend.
- `apps/api`: planned backend API.

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
pnpm --filter invitation-web dev
pnpm --filter admin-web dev
pnpm --filter api start:dev
```

Default local ports:

- invitation-web: `3000`
- admin-web: `3001`
- api: `4000`

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Source of Truth

Locked project documentation lives in `docs/`. Implementation work must follow those documents and the phase boundaries in `docs/IMPLEMENTATION-ROADMAP.md`.
