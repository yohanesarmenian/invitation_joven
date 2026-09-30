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
- Contract lock: Slice 5B0 locks the RSVP contract decisions (cutoff, `expectedVersion`, accepted-event minimum, dietary semantics, declined clean state, minimal pass invariant, Phase 6 boundary) before backend implementation.
- Tasks:
  - Implement shared Invitation row lock helper/pattern.
  - Implement RSVP service transaction in the locked mutation order.
  - Implement `expectedVersion` conflict policy: `null` is create-only, integer must match persisted `RSVP.version`; mismatch is `409 RSVP_VERSION_CONFLICT`.
  - Implement public RSVP cutoff enforcement against `Invitation.rsvp_deadline_at` for both create and update (`422 RSVP_DEADLINE_PASSED`), with public GET remaining available.
  - Implement `NAMED_INVITEE`, `PLUS_ONE`, and `ADDITIONAL_CHILD` validation.
  - Implement event selection validation and per-event expected count rules, including the accepted-event minimum.
  - Implement dietary notes normalization: trim, 500 character maximum after trimming, empty becomes `null`, `null` on decline.
  - Implement declined clean state: no attending selections, no attendee rows, null dietary notes, no active pass.
  - Implement CheckinPass creation/retention/revocation in the RSVP transaction.
  - Add public RSVP API and UI form.
  - Add decline confirmation state.
- Expected files/modules: rsvp backend module, checkin pass service, invitation-web RSVP section, api-client.
- Acceptance criteria:
  - Accepted RSVP cannot commit without required active CheckinPass state.
  - Accepted RSVP cannot commit with zero attending events.
  - Declined RSVP cannot leave active pass, attendee rows, or dietary notes.
  - Re-acceptance after decline creates a new pass; the revoked credential is never reactivated.
  - Ineligible event choices blocked by backend.
  - Event expected counts can differ and remain within attendee total.
  - Stale `expectedVersion` returns `409 RSVP_VERSION_CONFLICT`.
  - Post-cutoff create and update both return `422 RSVP_DEADLINE_PASSED`.
- Test/verification: backend integration tests for all RSVP/pass transitions, version conflict tests, cutoff tests, frontend form/E2E tests.
- Non-goals: QR rendering/presentation, QR scanner/check-in confirmation, admin import, public post-deadline override.
- Completion gate: guest can submit/update RSVP with atomic pass lifecycle according to the locked cutoff rule.

## Phase 6 - QR Presentation and Confirmation Screen

- Objective: Render active household QR and finalize guest confirmation screen integration.
- Prerequisite: Phase 5.
- Scope ownership: Phase 6 owns QR rendering, QR presentation, the QR-centric confirmation experience, and later pass/check-in presentation behavior. Phase 5 only guarantees the backend pass data invariant; it does not render or present a pass.
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

Phase 6 slices:

| Slice | Scope | Notes |
| --- | --- | --- |
| 6B0 | Guest pass / QR contract lock (docs only) | Locks QR payload format, declined behavior, and presentation surface. No code. |
| 6B | Backend `qrPayload` exposure | Re-derive the active CheckinPass credential and add `qrPayload` to the public `checkinPass` representation; regenerate OpenAPI and the generated client; add DB-backed and HTTP integration tests. No schema change. |
| 6C | Guest QR/pass presentation | Render the QR for an accepted RSVP with an active pass; render no QR for declined; textual fallback; responsive and accessibility work. invitation-web only. |
| 6D | Phase 6 QA | Mock E2E, real-backend smoke, privacy and security assertions (no `tokenHash`, no `credentialVersion`, no pass id, no credential in URL or logs). |

Phase 6 ownership boundary (locked in 6B0):

- Phase 6 owns: public active pass credential re-derivation, the public `qrPayload` response, guest QR rendering, accepted/declined pass presentation, the accessibility fallback, and guest-pass QA.
- Phase 6 does **not** own: admin login, admin session, CSRF, scanner, camera access, the QR validation endpoint, the confirm check-in mutation, `CheckinRecord` creation, manual check-in, or reporting.
- Phase 8 owns the admin auth foundation. Phase 10 owns the scanner and venue check-in.
- Phase 6 changes no RSVP mutation semantics and creates no `CheckinRecord`.

## Phase 7 - Guest Messages

- Objective: Implement public message submission. Admin message visibility and moderation move to Phase 8 with the admin foundation.
- Prerequisite: Phase 6.
- Contract lock: Slice 7B0 locks the Phase 7 guest-message contract (retry/idempotency, content limits, submission window, author identity, create-only public API and response shape, error contract, abuse posture) before backend implementation.
- Tasks:
  - Implement public message endpoint with active-invitation enforcement.
  - Implement message form and confirmation overlay.
- Expected files/modules: messages module, invitation-web message section, api-client.
- Acceptance criteria:
  - Message associates with active invitation.
  - Archived/unavailable invitation cannot submit message.
  - Confirmation overlay returns to invitation.
  - Public response exposes only `message.createdAt`; `GuestMessage.id` stays internal.
- Test/verification: backend tests and Playwright flow.
- Non-goals: public message list/wall, message update/delete, admin authentication, admin message listing, moderation UI, hide/unhide UI, CAPTCHA, and rate-limit infrastructure. Admin message visibility and moderation are Phase 8+.
- Completion gate: guests can submit wishes safely.

Phase 7 slices:

| Slice | Scope | Notes |
| --- | --- | --- |
| 7A | Guest messages discovery + contract audit | Read-only discovery against the repository; produced the D1-D7 decision inventory. No code. |
| 7B0 | Guest messages contract lock (docs only) | Locks D1-D7: create-only append semantics with no idempotency key, the 1000/100 plain-text content caps, submission window independent of the RSVP deadline, optional free-text `authorName`, create-only public API returning only `createdAt`, no new `MESSAGE_*` error code, and the accepted no-rate-limit MVP posture. No code and no schema change. |
| 7B | Backend public message endpoint | `messages` module, DTOs, `POST /api/public/invitations/{publicCredential}/messages` reusing the active-invitation credential resolution boundary, DB-backed and HTTP integration tests, OpenAPI regeneration, and generated client update. No schema change and no migration. |
| 7C | invitation-web message form + confirmation | Replace the section-11 placeholder with the real form and the `Message Sent!` confirmation state. invitation-web only. No route change and no public message wall. |
| 7D | Phase 7 QA | Mock E2E, real-backend smoke, privacy and regression audit. |

Phase 7 ownership boundary (locked in 7B0):

- Phase 7 owns: the public guest-message `POST`, plain-text validation, active-invitation enforcement, `GuestMessage` persistence, OpenAPI and generated client updates, the invitation-web message form, the `Message Sent!` confirmation state, guest-side error and retry UX, and Phase 7 QA.
- Phase 7 does **not** own: public message list/wall, message update/delete, admin authentication, admin message listing, moderation UI, hide/unhide UI, CAPTCHA, rate-limit infrastructure, or any change to `RSVP.guestNote`.
- Phase 8 owns the admin auth foundation and admin message visibility/moderation.
- Phase 7 changes no RSVP, pass, or check-in semantics, and requires **no schema change and no migration**.

## Phase 8 - Admin Frontend and Auth

- Objective: Build OWNER admin interface and protected session flow.
- Prerequisite: backend auth/session implementation plan finalized for deployment topology. **Satisfied by Slice 8B0** (auth/security contract lock).
- Tasks:
  - Finalize production same-site/origin topology, cookie attributes, CSRF issuance/recovery, allowed credentialed origins, logout cookie clearing, and expired-session cleanup. **Done in Slice 8B0.**
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
- Test/verification: E2E auth/protected route tests, API integration tests, the admin route-inventory security regression test required by Slice 8D0 (every `/api/admin/**` route except login rejects a missing session with `401 UNAUTHENTICATED`; every unsafe admin route rejects a missing/wrong CSRF token or bad origin with `403 CSRF_INVALID`), and public regression coverage for invitations, archive, eligibility, regeneration, and the RSVP pass lifecycle.
- Non-goals: complex RBAC, role management UI.
- Completion gate: admin can manage core invitation lifecycle.

### Phase 8 scope (locked in Slice 8B0)

Phase 8 is **not** only authentication. Phase 8 owns:

- admin authentication: first-OWNER bootstrap, Argon2id password hashing, opaque sessions, login, logout, current session, CSRF, origin enforcement, login throttling, the authentication and OWNER guards
- the `apps/admin-web` authenticated shell: login, server-side session bootstrap, protected layout, logout, session-expiry UX
- dashboard
- invitation list, detail, create, edit, archive
- invitee management
- `InvitationEvent` eligibility management
- RSVP overview, detail, and OWNER override
- **Guest Message visibility and moderation** — owned by Phase 8, but contract-locked separately (Slice 8D0) and implemented after the auth foundation

Phase 8 does **not** own:

- CSV/XLSX import — Phase 9
- QR scanner and venue check-in — Phase 10
- reporting and CSV export — Phase 11
- Event catalog/management beyond `InvitationEvent` eligibility — not silently added
- role management, additional-OWNER creation, or non-`OWNER` roles

**Phase 8 is not complete once authentication and the admin shell ship.** The admin-management surface (8D0 onward) is part of Phase 8.

### Phase 8 slices (locked in Slice 8B0)

| Slice | Scope | Notes |
| --- | --- | --- |
| 8A | Admin foundation discovery / auth audit | Read-only discovery against the repository; produced the D1-D13 decision inventory. No code. |
| 8B0 | Auth/security contract lock (docs only) | Resolves D1-D13: same-origin topology, `__Host-` cookie, operator-only bootstrap, Argon2id parameters, opaque session lifetime, session-bound CSRF, origin validation, the auth error contract, in-process login throttling, route-protection and API-client doctrine, and guest-message ownership. No code, no schema change, no migration. |
| 8B | Backend auth foundation | Bootstrap CLI, Argon2id, login, `me`, logout, sessions, guards, OWNER authorization, CSRF, origin enforcement, login throttling, OpenAPI and generated client. |
| 8C | admin-web auth foundation | Login, session bootstrap, authenticated shell, protected layout, logout, session-expiry UX. |
| 8D0A | Admin-management contract discovery / audit (docs only) | Read-only audit of the remaining admin-management surface. Established that no schema change is required and produced the D1-D24 decision inventory. No code. |
| 8D0B | Admin-management contract lock (docs only, this slice) | Resolves D1-D24: shared pagination/sorting/search, the admin error doctrine, the Phase 8 dashboard metric set, invitation list/detail/create/edit/archive/public-url/regeneration, invitee create/edit/delete and RSVP snapshot semantics, declarative eligibility replacement with selection-reference rejection, the event read endpoint, RSVP list/detail and the OWNER override, guest-message listing and `isHidden` moderation, the admin-web route and state contract, and the shared admin enforcement surface. Also resolves the invitation-link regeneration retry/idempotency question carried from 8B0. No code, no schema change, no migration. |
| 8D1 | Backend shared admin plumbing + dashboard + invitation reads | Shared enforcement surface and its route-inventory security test, shared pagination/sorting/search, dashboard, `GET /api/admin/events`, invitation list, invitation detail, and `public-url`. OpenAPI and generated client for these routes. No mutation beyond the auth infrastructure. |
| 8D2 | Backend invitation mutations | Create, edit, archive, and `regenerate-token`, including the `expectedUpdatedAt` and `expectedTokenVersion` concurrency contracts and the shared transaction body for the Invitation row lock. |
| 8D3 | Backend invitee + eligibility management | Invitee create/update/delete with the FK-reference safety rule, post-RSVP snapshot semantics, and the declarative eligibility replacement endpoint. |
| 8D4 | Backend RSVP admin | RSVP list, RSVP detail, reuse of the public RSVP lifecycle for the OWNER override, actor/reason attribution, and the deadline-bypass contract. |
| 8D5 | Backend guest message admin | Global list, invitation-scoped list, and `isHidden` moderation. |
| 8E1 | admin-web dashboard + invitation list | Shared shell navigation, dashboard, and the invitation list with filters and pagination. |
| 8E2 | Invitation create/detail/edit/archive/regeneration UI | Includes the archive and regeneration confirmations and the regeneration uncertain-outcome recovery. |
| 8E3 | Invitee + eligibility UI | Invitee CRUD and eligibility replacement inside the invitation detail route. |
| 8E4 | RSVP admin UI | RSVP list, RSVP detail, and the OWNER override form. |
| 8E5 | Guest message moderation UI | `/messages` with the hide/unhide action. |
| 8F | Final integrated Phase 8 QA | Auth, privacy, CSRF, session-expiry, admin-management, and public-regression audit. |

Model routing: 8D1-8D4 are transaction- and security-sensitive and use GPT-5.5 HIGH / Codex. 8D5 is bounded and low-coupling and may use DeepSeek V4.1 Flash, escalating to GPT-5.5 HIGH if the shared-query or refactoring surface grows. 8E1-8E5 use Astra 6 HIGH. 8D0 and 8F are docs/audit work.

Slice order is a dependency order, not a requirement to keep both tracks strictly serial: 8E1 may begin once 8D1 has landed, and each 8E slice depends only on the 8D slice that provides its route contract.

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
