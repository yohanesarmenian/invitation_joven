# Implementation Roadmap

Do not begin Phase 1 until Phase 0 documentation corrections are accepted. This roadmap is detailed enough to create future tasks but is not a set of coding prompts.

## Phase 0 - Documentation / Architecture Lock

- Objective: Establish and reconcile project source of truth.
- Prerequisite: Approved product brief and architecture audit corrections.
- Tasks:
  - Create/update source-of-truth docs.
  - Resolve attendance ownership terminology.
  - Lock deterministic credential architecture.
  - Lock RSVP versioning and Invitation row lock order.
  - Use `CheckinRecord` as the confirmed attendance entity.
  - Document remaining open questions with blocking phases.
- Expected files/modules: `docs/`.
- Acceptance criteria:
  - All approved docs exist.
  - Phase 0D corrections are reflected consistently.
  - Open questions contain only genuinely unresolved items.
- Test/verification: documentation review and workspace check.
- Non-goals: application code, framework initialization, dependency installation.
- Completion gate: owner accepts final Phase 0 documentation lock.

## Phase 1 - Monorepo and Repository Foundation

- Objective: Initialize repository structure and shared tooling.
- Prerequisite: final Phase 0 documentation lock.
- Tasks:
  - Initialize Git only if requested.
  - Create pnpm workspace and Turborepo structure.
  - Add TypeScript config package.
  - Add eslint/prettier or equivalent repository rules.
  - Create empty app/package scaffolds without domain implementation.
- Expected files/modules: root package files, `apps/`, `packages/`.
- Acceptance criteria:
  - Workspace commands run.
  - No product logic added.
- Test/verification: install, lint baseline, typecheck baseline.
- Non-goals: Prisma schema, UI implementation, API endpoints.
- Completion gate: clean foundation with documented commands.

## Phase 2 - Database and Backend Foundation

- Objective: Establish NestJS API foundation and PostgreSQL persistence model.
- Prerequisite: Phase 1.
- Tasks:
  - Create NestJS app with Fastify.
  - Add Prisma and PostgreSQL connection.
  - Translate documented schema into Prisma and custom SQL where required.
  - Include `public_token_version`, aggregate open fields, RSVP `version`, RSVP attendee rules, CheckinPass credential version, and CheckinRecord uniqueness.
  - Add migration workflow.
  - Add health endpoint.
  - Add common error envelope.
  - Add Pino logging with credential redaction.
  - Add security helper interfaces for deterministic credential derivation.
- Expected files/modules: `apps/api`, Prisma schema/migrations, security/common/database modules.
- Acceptance criteria:
  - Database migrates locally.
  - Health endpoint works.
  - Partial indexes/conditional constraints are represented or explicitly handled by custom SQL.
  - Sensitive fields are redacted from logs.
- Test/verification: backend unit tests, migration apply/reset in dev DB.
- Non-goals: public UI, admin UI, QR scanner.
- Completion gate: backend foundation ready for domain modules.

## Phase 3 - Public Invitation API

- Objective: Implement active public invitation retrieval and privacy boundaries.
- Prerequisite: Phase 2.
- Tasks:
  - Slice 0 - Documentation lock:
    - Lock credential wire format, lookup hash, nullable RSVP response, deadline location, public DTO privacy, open-tracking transaction semantics, and implementation slice gates.
  - Slice 1 - Credential infrastructure:
    - Scope: credential secret provider, canonical input construction, HMAC derivation, lookup hashing, and compatibility/golden tests.
    - Proposed commit: `feat(api): implement deterministic invitation credentials`.
    - Executor: Codex 5.5.
    - Review: Sol security review.
  - Slice 2 - Public DTO contract:
    - Scope: DTO types, nullable RSVP, `rsvpDeadlineAt`, privacy mapper, and deterministic ordering contract.
    - Proposed commit: `feat(api): define public invitation response`.
    - Executor: Codex 5.5.
    - Review: Sol contract review.
  - Slice 3 - Transactional retrieval:
    - Scope: hash lookup, Invitation `FOR UPDATE`, `ACTIVE` policy, atomic open aggregates, projection reads, and concurrency tests.
    - Proposed commit: `feat(api): add transactional public invitation retrieval`.
    - Executor: Codex 5.5.
    - Review: Sol concurrency review required.
  - Slice 4 - Endpoint + OpenAPI/API client:
    - Scope: controller, exact public error behavior, OpenAPI DTO/decorators, client generation/update, and endpoint integration tests.
    - Proposed commit: `feat(api): expose public invitation endpoint`.
    - Executor: Codex 5.5.
    - Review: Sol privacy review.
  - Slice 5 - Final security/concurrency/privacy audit:
    - Executor: Sol.
    - Coverage: credential leakage, archive/privacy behavior, open concurrency, DTO privacy, logs, API contract, and phase scope.
- Expected files/modules: invitations, events, public API, security, api-client.
- Acceptance criteria:
  - Valid active credential retrieves only own invitation data.
  - Archived/invalid credentials do not leak availability details.
  - Open aggregate fields update without storing IP/user-agent.
- Test/verification: unit/integration tests for credential lookup, archive denial, open aggregate update, and response privacy.
- Non-goals: RSVP mutation, QR scanner, frontend build.
- Completion gate: public invitation API contract implemented.

## Phase 4 - Figma-Based Public Invitation Frontend

- Objective: Build the public invitation visual experience without RSVP submission.
- Prerequisite: Phase 3.
- Tasks:
  - Slice 0 - Frontend contract lock:
    - Scope: public route, server/client data flow, Figma node references,
      unavailable/error/loading UX, responsive contract, deferred interactions,
      asset/font policy, dependency decisions, and slice blockers.
    - Proposed commit: `docs: lock phase 4 public frontend contract`.
    - Executor: Codex 5.5.
    - Review: Sol privacy/data-flow review if requested.
  - Slice 1 - Public route + API retrieval shell:
    - Scope: `/i/[publicCredential]` route, server-side retrieval using generated
      API client, `INVITATION_API_BASE_URL`, loading, generic unavailable state,
      generic unexpected-error state, and no duplicate client fetching.
    - Proposed commit: `feat(web): add public invitation route`.
    - Executor: Codex 5.5.
    - Review: Sol privacy review.
  - Slice 2 - Read-only long invitation layout:
    - Scope: render `PublicInvitationResponse` into the locked section order,
      preserve event order, handle nullable fields, avoid raw UUID display unless
      visually required, and keep RSVP/message areas non-functional.
    - Proposed commit: `feat(web): render public invitation content`.
    - Executor: Codex 5.5.
    - Review: Codex.
  - Slice 3 - Envelope/open cover interaction:
    - Scope: closed envelope, accessible open control, opened cover transition,
      transition/reveal to long content, local in-memory UI state, and
      reduced-motion behavior.
    - Proposed commit: `feat(web): add invitation opening flow`.
    - Executor: Codex 5.5.
    - Review: Codex.
  - Slice 4 - Approved assets/fonts/visual fidelity:
    - Scope: approved exported assets, font loading, palette, spacing, desktop
      framing, and Figma-recognizable visual polish.
    - Proposed commit: `style(web): align invitation visuals with figma`.
    - Executor: Codex 5.5.
    - Review: Sol or owner visual audit if fidelity-sensitive.
  - Slice 5 - Verification hardening:
    - Scope: tests, responsive screenshots, accessibility checks, visual/manual
      QA gates, and final Phase 4 audit.
    - Proposed commit: `test(web): cover public invitation frontend`.
    - Executor: Codex 5.5.
    - Review: Sol final privacy/UI audit.
- Expected files/modules: `apps/invitation-web`.
- Acceptance criteria:
  - Mobile widths render without overlap.
  - Larger screens remain centered/narrow.
  - Figma journey is recognizable.
  - Archived/unknown invitation state does not leak details.
- Test/verification: Playwright screenshots at target widths, accessibility checks.
- Non-goals: final assets if not provided, RSVP submit, QR scanner.
- Completion gate: public read-only invitation works.
- Slice blockers:
  - Slice 1 does not depend on final visual assets.
  - Slice 2 can proceed with approved/current content structure but must not
    resolve final copy or date/deadline conflicts by assumption.
  - Slice 3 may be partially blocked by final separated envelope cuts/assets if
    high-fidelity animation is required; a simpler accessible structure can
    proceed if approved.
  - Slice 4 is blocked by approved final assets and font availability/licensing.
  - Slice 5 depends on prior slices.

## Phase 5 - RSVP and CheckinPass Lifecycle

- Objective: Implement RSVP lifecycle, attendee modeling, event expected counts, versioning, and pass state atomically.
- Prerequisite: Phases 2-4.
- Tasks:
  - Implement shared Invitation row lock helper/pattern.
  - Implement RSVP service transaction.
  - Implement `expectedVersion` conflict policy.
  - Implement `NAMED_INVITEE`, `PLUS_ONE`, and `ADDITIONAL_CHILD` validation.
  - Implement event selection validation and per-event expected count rules.
  - Implement dietary notes.
  - Implement CheckinPass creation/retention/revocation in the RSVP transaction.
  - Add public RSVP API and UI form.
  - Add decline confirmation state.
- Expected files/modules: rsvp backend module, checkin pass service, invitation-web RSVP section, api-client.
- Acceptance criteria:
  - Accepted RSVP cannot commit without required active CheckinPass state.
  - Declined RSVP cannot leave active pass.
  - Re-acceptance after decline creates a new pass.
  - Ineligible event choices blocked by backend.
  - Event expected counts can differ and remain within attendee total.
  - Stale `expectedVersion` returns `409 RSVP_VERSION_CONFLICT`.
- Test/verification: backend integration tests for all RSVP/pass transitions, version conflict tests, frontend form/E2E tests.
- Non-goals: QR scanner/check-in confirmation, admin import.
- Completion gate: guest can submit/update RSVP with atomic pass lifecycle according to confirmed cutoff rule.

## Phase 6 - QR Presentation and Confirmation Screen

- Objective: Render active household QR and finalize guest confirmation screen integration.
- Prerequisite: Phase 5.
- Tasks:
  - Add QR payload response handling.
  - Render QR after accepted RSVP.
  - Render declined RSVP confirmation without QR.
  - Add reload/retry behavior for network failures.
  - Ensure public UI never displays token hashes or credential versions.
- Expected files/modules: invitation-web confirmation screens, public RSVP/pass responses, api-client.
- Acceptance criteria:
  - Accepted guest sees active household QR.
  - Declined guest sees no QR.
  - Public QR never exposes internal UUID alone, token hash, or credential version.
- Test/verification: Playwright RSVP accepted/declined confirmation flows.
- Non-goals: venue scanner UI and CheckinRecord creation.
- Completion gate: public confirmation surfaces are complete.

## Phase 7 - Guest Messages

- Objective: Implement public message submission and admin visibility.
- Prerequisite: Phase 3 or later.
- Tasks:
  - Decide retry/idempotency policy for guest messages.
  - Add public message endpoint with active-invitation enforcement.
  - Add message form and confirmation overlay.
  - Add admin message list/detail surface if admin foundation exists.
- Expected files/modules: messages module, invitation-web message section, admin-web messages later if needed.
- Acceptance criteria:
  - Message associates with active invitation.
  - Archived/unavailable invitation cannot submit message.
  - Confirmation overlay returns to invitation.
- Test/verification: backend tests and Playwright flow.
- Non-goals: public message wall unless approved.
- Completion gate: guests can submit wishes safely.

## Phase 8 - Admin Frontend and Auth

- Objective: Build OWNER admin interface and protected session flow.
- Prerequisite: backend auth/session implementation plan finalized for deployment topology.
- Tasks:
  - Finalize production same-site/origin topology, cookie attributes, CSRF issuance/recovery, allowed credentialed origins, logout cookie clearing, and expired-session cleanup.
  - Create Next.js admin app with shadcn/ui.
  - Implement login/logout/session handling.
  - Build dashboard.
  - Build invitation list/detail/create/edit/archive.
  - Build invitee and eligibility management.
  - Build RSVP overview/detail/override using same RSVP/pass lifecycle.
- Expected files/modules: `apps/admin-web`, auth, invitations, invitees, rsvp modules.
- Acceptance criteria:
  - OWNER can manage invitations without direct DB access.
  - Protected routes enforce session.
  - Archive denies public access/check-in while preserving admin history.
- Test/verification: E2E auth/protected route tests, API integration tests.
- Non-goals: complex RBAC, role management UI.
- Completion gate: admin can manage core invitation lifecycle.

## Phase 9 - CSV/XLSX Import

- Objective: Implement validated guest import.
- Prerequisite: Phase 8 invitation management.
- Tasks:
  - Define import template.
  - Define preview lifetime and idempotent commit semantics.
  - Parse CSV/XLSX.
  - Validate required fields and event eligibility columns.
  - Detect duplicate warnings.
  - Build preview UI.
  - Commit selected rows atomically.
  - Initialize invitation credential version/hash during commit.
  - Store successful import batch audit.
- Expected files/modules: imports module, admin import UI.
- Acceptance criteria:
  - Upload does not insert records.
  - Preview is not a GuestImportBatch.
  - Errors block rows.
  - Warnings require acknowledgment.
  - No automatic merge of possible duplicates.
  - Commit is all-or-nothing for selected valid rows.
- Test/verification: parser tests, integration tests, E2E preview/commit.
- Non-goals: XLSX report export.
- Completion gate: OWNER can import guests predictably.

## Phase 10 - QR Scanner and Venue Check-in

- Objective: Implement event-aware venue check-in with CheckinRecord confirmation.
- Prerequisite: Phase 6 and admin frontend.
- Tasks:
  - Build browser QR scanner.
  - Implement read-only validate endpoint UI.
  - Implement explicit confirmation.
  - Implement shared QR/manual confirmation domain service.
  - Implement duplicate-safe CheckinRecord transaction using Invitation/Event uniqueness.
  - Add manual search fallback.
  - Add scanner error states for invalid, revoked, unavailable, event-not-allowed, event-not-selected, and already-confirmed.
- Expected files/modules: checkin module, admin check-in UI.
- Acceptance criteria:
  - Validation preview does not create CheckinRecord.
  - Wrong event/revoked/declined/duplicate states are clear.
  - Concurrent confirmations cannot double check in.
  - Manual lookup uses same domain rules after invitation resolution.
  - `attendeeCount` must be 1..expected event count.
- Test/verification: backend concurrency tests, Playwright scanner/manual flow where feasible.
- Non-goals: raw scan-attempt audit table, offline-first check-in, over-capacity walk-in semantics.
- Completion gate: event staff can check households in safely.

## Phase 11 - Reporting

- Objective: Implement dashboard metrics and CSV export.
- Prerequisite: RSVP, check-in, import data available.
- Tasks:
  - Finalize CSV export grouping.
  - Build report queries from open aggregates, RSVPAttendee, RSVPEventSelection, and CheckinRecord.
  - Add dashboard summary API.
  - Add CSV export endpoints with archived filter behavior.
  - Add admin reporting UI.
- Expected files/modules: reports module, admin dashboard/report pages.
- Acceptance criteria:
  - MVP metrics available.
  - Active metrics exclude archived invitations by default.
  - Archived invitations can be included by explicit filter where supported.
  - CSV export works.
  - XLSX export not included.
- Test/verification: query tests with seeded data, CSV format tests.
- Non-goals: analytics warehouse, real-time dashboard.
- Completion gate: OWNER can view and export MVP reports.

## Phase 12 - QA / Security / Deployment

- Objective: Prepare MVP for production use.
- Prerequisite: feature phases complete.
- Tasks:
  - Complete E2E coverage for public/admin critical paths.
  - Security review for credentials, sessions, CSRF, logging, and public privacy.
  - Concurrency review for RSVP and check-in.
  - Plan credential-secret operational rotation/regeneration process.
  - Dockerize apps.
  - Add GitHub Actions.
  - Prepare VPS/Coolify-style deployment.
  - Before deployment: verify reverse-proxy access logs redact or exclude credential-bearing public URLs (`/i/*`, `/api/public/invitations/*`); see `DEPLOYMENT-SECURITY.md`.
  - Final content/assets verification.
- Expected files/modules: CI, Docker, deployment config, tests.
- Acceptance criteria:
  - Verification commands pass.
  - Secrets are externalized.
  - Public and admin flows pass E2E.
  - Final copy/assets approved.
- Test/verification: full test suite, build, migration, Playwright, manual smoke test.
- Non-goals: new product features or multi-key credential-secret rotation infrastructure.
- Completion gate: production deployment candidate accepted.
