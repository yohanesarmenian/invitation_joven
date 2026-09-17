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
