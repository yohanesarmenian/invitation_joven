# Development Rules

## Source of Truth

- Follow the source-of-truth hierarchy in `PROJECT-CONTEXT.md`.
- Do not silently change architecture, domain rules, data model, API behavior, or UI semantics.
- If implementation requirements conflict with documentation, update or escalate the higher-authority document first.
- Keep `OPEN-QUESTIONS.md` current when unresolved decisions affect implementation.

## Scope Control

- Work one phase/task at a time.
- Do not expand scope beyond the approved task.
- Do not introduce SaaS, payments, marketing automation, CMS, multiple themes, microservices, or cloud infrastructure unless explicitly approved.
- Do not initialize frameworks or install packages during documentation-only phases.

## Repository Practice

- Inspect existing files and Git status before modifying.
- Preserve user changes and unrelated work.
- Avoid broad refactors during unrelated tasks.
- Keep module boundaries intact.
- Maintain a clean worktree expectation: report created/modified files and verification results at task completion.

## Architecture Rules

- The backend is the authority for business validation.
- Frontends must not access PostgreSQL directly.
- API changes require API Contract updates.
- Database changes require Database Schema documentation and a migration plan.
- OpenAPI is the source for generated API clients.
- Avoid duplicated frontend/backend interface definitions outside the OpenAPI generation workflow.
- Invitation-scoped state changes that can conflict must lock the target Invitation row first, then reload and revalidate dependent state inside the same transaction.
- Do not introduce Redis, distributed locks, queues, or other concurrency infrastructure for MVP invitation-scoped locking.
- Accepted RSVP and CheckinPass lifecycle must be implemented atomically from the first RSVP implementation.
- Public RSVP mutations use `expectedVersion: null` for create-only and an exact persisted integer for updates. Do not pre-create empty RSVP rows to manufacture a version.
- Public RSVP create and update are both cut off at `Invitation.rsvp_deadline_at`; after the cutoff both return `422 RSVP_DEADLINE_PASSED`. Do not add a public override.
- Phase 5 owns only the minimal CheckinPass data lifecycle. QR rendering, presentation, scanning, and check-in remain later-phase work.
- QR validation must remain read-only. Only explicit confirmation creates `CheckinRecord`.
- Manual check-in and QR check-in must share the same backend domain confirmation path after invitation resolution.

## Security Rules

- Secrets must never be committed.
- Public invitation credentials, check-in credentials, admin session tokens, token hashes, credential hashes, passwords, and password hashes must never be logged.
- Long-lived sensitive admin credentials must not be stored in localStorage.
- Admin passwords must be hashed with Argon2id.
- Public invitation and check-in credentials must be derived server-side and must not be stored as plaintext.
- Public invitation APIs must not expose credential hashes, credential versions, sequential IDs, admin fields, or other invitations.
- Check-in and RSVP state transitions must be transactionally safe.

Admin authentication rules (locked in Phase 8 Slice 8B0):

- The backend is the authoritative security boundary. Admin-web route protection is UX and defense in depth. Never treat client route state, hidden UI, a Next layout, or browser-side role data as authorization.
- Every `/api/admin/**` operation except login independently enforces a valid session, and where required OWNER authorization, and for unsafe methods CSRF plus origin validation.
- First-OWNER creation is an operator-only CLI. Do not add a network bootstrap, setup, or registration route, and do not add default credentials.
- The first-OWNER command refuses once any `AdminUser` exists. Do not add a second-OWNER workflow, an admin-user creation UI, or role management in Phase 8.
- Sessions are opaque, not JWT. Generate 32 cryptographically secure random bytes per login and persist only `SHA-256(sessionToken)`. Never accept a client-supplied session identifier.
- The raw session token and raw CSRF token are never persisted, returned in JSON, logged, or placed in a URL or browser storage.
- Use the session-bound `X-CSRF-Token` for unsafe methods and exact `Origin`/`Referer` validation against `ADMIN_ORIGIN`. Do not treat `SameSite=Strict` as a CSRF solution.
- Do not enable broad CORS or cross-origin credentialed requests for the admin surface.
- Login failure must return one indistinguishable response for unknown email, wrong password, and a `DISABLED` account. Do not add a distinct `SESSION_EXPIRED` public code.
- The login and bootstrap request payloads must never be logged. Do not blanket-redact the normalized admin email.
- Keep login throttling in-process for the MVP, and document the single-API-instance constraint before any horizontal scaling.
- Password reset, password change, and MFA are outside the Phase 8 auth foundation. Do not add them by assumption.

Admin management rules (locked in Phase 8 Slice 8D0):

- Admin management endpoints do not re-implement security per controller. Session, OWNER, CSRF, and origin enforcement is one shared backend surface. A new unsafe `/api/admin/**` route must inherit it by construction, and a route-inventory security test must fail if a route is added without it.
- `GET`, `HEAD`, and `OPTIONS` admin routes must not mutate state and require no CSRF token. `POST`, `PUT`, `PATCH`, and `DELETE` require session, OWNER, exact origin, and a valid `X-CSRF-Token`. Login is the only exception.
- Admin list endpoints share one pagination envelope, one sort convention with an `id ASC` tie-breaker, and one search normalization. Do not invent per-endpoint shapes of the same concept.
- Admin responses use explicit DTOs. Never return a Prisma model directly because the caller is authenticated.
- Admin resource lookups return `404 NOT_FOUND`. Do not reuse the public `404 INVITATION_NOT_AVAILABLE`, which exists to keep public credential resolution indistinguishable.
- Invitation update concurrency uses `expectedUpdatedAt`. There is no `Invitation.version` column and none is added. Invitee update uses the same mechanism.
- Do not silently use last-writer-wins for admin mutations that can conflict.
- Invitation archive is idempotent, carries no `reason` payload, and has no unarchive counterpart. Do not accept data that no column can persist.
- Every mutation on an `ARCHIVED` invitation is rejected with `409 CONFLICT`, except explicitly read-only historical access.
- Token regeneration requires `expectedTokenVersion` and rotates exactly once per displayed state. Never auto-retry it, and never add an idempotency key or idempotency table. Recovery is a re-read of `GET /api/admin/invitations/{id}/public-url`, because derivation is deterministic.
- The admin public-url path must not touch `openCount`, `firstOpenedAt`, or `lastOpenedAt`. Only a valid public guest retrieval records an open.
- The guest-facing origin comes from the non-secret `PUBLIC_INVITATION_BASE_URL`. Never build it from a request header or an arbitrary per-request host.
- Eligibility replacement is declarative and all-or-nothing. Reject the entire replacement with `409 CONFLICT` if any `RSVPEventSelection` references an event being removed. Never orphan, delete, or rewrite an RSVP selection to make a removal succeed.
- Invitee deletion is hard delete, permitted only when no `RSVPAttendee` references the invitee. There is no soft-delete or inactive invitee state, and none is added.
- Editing an Invitee never rewrites an existing `RSVPAttendee` snapshot. Correct submitted RSVP composition through the RSVP override flow.
- The OWNER RSVP override reuses the public RSVP lifecycle implementation and must not fork `CheckinPass` semantics. It may bypass `rsvpDeadlineAt`; it must not bypass `ACTIVE`, eligibility, composition, capacity, transition, pass-lifecycle, or `expectedVersion` rules.
- Every successful OWNER RSVP override writes `submittedByAdminUserId` and `adminOverrideReason`. These fields describe the current RSVP state: a later successful public RSVP clears both, while failed public mutations preserve both. `guestNote` is not written in Phase 8.
- Phase 8 adds no generic audit-log table. Invitation, invitee, eligibility, archive, regeneration, and guest-message-moderation mutations carry no actor attribution, and `GuestMessage` moderation carries no actor or timestamp. These are declared MVP limitations, not omissions to fix silently.
- Phase 8 does not own the Event catalog. Only `InvitationEvent` eligibility is managed. No `Event` create/update/delete route is added.
- `isHidden` is an internal moderation flag with no public guest-facing effect, because no public message wall exists. Do not imply one.

## Testing and Verification

- Meaningful domain logic requires tests.
- RSVP lifecycle, pass issuance/revocation, event eligibility, duplicate check-in prevention, import validation, and admin auth require backend tests.
- RSVP version conflicts and shared Invitation row lock behavior require backend tests where feasible.
- Check-in confirmation requires a duplicate/concurrency test proving unique Invitation/Event protection.
- Public and admin critical flows require Playwright coverage when UI exists.
- Before task completion, run the relevant verification commands for the touched area and report any command that could not be run.

## Documentation Updates

- Update PRD for product behavior changes.
- Update Technical Architecture for system responsibility or module boundary changes.
- Update Database Schema for persistence changes.
- Update API Contract for route, request, response, error, or auth changes.
- Update UI/UX Spec for screen, state, flow, visual, validation, loading, or error behavior changes.
- Update Implementation Roadmap when phase order, scope, or completion gates change.
