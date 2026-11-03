# CI failure closure: RSVP deadline and admin inventory

Date: 2026-11-03 (Asia/Jakarta). Branch: `fix/ci-rsvp-deadline-route-inventory`.
Base HEAD: `24b89cf8f560752a3b3a7690594679928a2929ef`.
Status: **READY_FOR_REVIEW** after the Docker recovery and real PostgreSQL
verification recorded below. GitHub-hosted CI for the uncommitted patch remains
pending; no remote CI success is claimed.

## Complete original CI evidence

Read the complete validate job log for [CI run 41581270826](https://github.com/yohanesarmenian/invitation_joven/actions/runs/41581270826),
job 125736439774, at the exact base SHA. The log reports API **291 passed,
10 failed, 40 files**. GitHub CLI initially returned 401 and the connector 404;
the existing Git credential helper subsequently provided authenticated read access.
Credentials were not printed or saved. Complete raw logs remain in ignored
`.local-daily/ci-failure-closure/job-125736439774.log`, not a publishable artifact.

The following are all ten failures from the complete Vitest failure section.
Paths below are relative to `apps/api/src`; line numbers are failing assertions
at the original CI commit, not post-patch lines. Names are the original test names.

| Test name                                                                             | Original file:line                                          | Expected                      | Actual / immediate error                                        | Root cause                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| inventories all admin routes and enforces shared admin security                       | admin/admin-read.http.integration.spec.ts:343               | 45 routes                     | 48 routes; length assertion                                     | Event Management routes absent from inventory                           |
| creates an accepted RSVP over HTTP and does not expose credential-bearing pass fields | invitations/public-invitation.http.integration.spec.ts:531  | HTTP 200                      | HTTP 422; status assertion                                      | Expired default deadline                                                |
| returns the current RSVP state over HTTP without recording an invitation open         | invitations/public-invitation.http.integration.spec.ts:601  | RSVP submission HTTP 200      | HTTP 422; status assertion                                      | Expired default deadline                                                |
| returns accepted RSVP state from the dedicated RSVP GET                               | invitations/public-invitation.http.integration.spec.ts:694  | Accepted RSVP and active pass | GET succeeds but rsvp/checkinPass are null; object assertion    | Unasserted setup submission rejected by deadline                        |
| updates an existing public RSVP with the current expectedVersion                      | invitations/public-invitation.http.integration.spec.ts:783  | HTTP 200                      | HTTP 422; status assertion                                      | Expired default deadline                                                |
| returns qrPayload according to the public pass lifecycle over HTTP                    | invitations/public-invitation.http.integration.spec.ts:829  | Active CheckinPass row        | PrismaClientKnownRequestError, findFirstOrThrow found no record | First accept rejected before pass issuance; assertion occurred too late |
| rejects event selections outside the invitation eligibility list                      | invitations/public-invitation.http.integration.spec.ts:970  | HTTP 422 EVENT_NOT_ALLOWED    | HTTP 422 RSVP_DEADLINE_PASSED; error-code assertion             | Deadline validation correctly precedes eligibility                      |
| transitions an accepted public RSVP to declined and removes active pass exposure      | invitations/public-invitation.http.integration.spec.ts:1027 | HTTP 200 decline              | HTTP 422; status assertion                                      | Expired default deadline                                                |
| maps stale public RSVP versions to a 409 error envelope                               | invitations/public-invitation.http.integration.spec.ts:1075 | HTTP 409                      | HTTP 422; status assertion                                      | Deadline validation correctly precedes version                          |
| maps public RSVP domain validation failures to a 422 error envelope                   | invitations/public-invitation.http.integration.spec.ts:1103 | HTTP 422 EVENT_NOT_SELECTED   | HTTP 422 RSVP_DEADLINE_PASSED; error-code assertion             | Deadline validation correctly precedes composition/selection            |

## Deadline root cause and correction

The fixture defaulted to `2026-11-01T12:00:00.000Z`. CI ran at approximately
`2026-11-03T05:02Z`. That persisted instant was expired regardless of Linux/Windows
timezone. The original reception date was `2026-12-12T12:00:00Z`; this is not a
Prisma serialization or Event date timezone defect. Production uses new Date()
through the existing optional PUBLIC_RSVP_CLOCK provider; it rejects only when
mutationTime > persisted deadline, before version and eligibility validation.
API-CONTRACT.md's cutoff is inclusive. Production behavior is correct.

The HTTP suite now supplies PUBLIC_RSVP_CLOCK from an app-scoped test-only global
Nest module, following the existing service test's injected-clock convention.
The stable UTC test instant is `2026-10-01T00:00:00Z`; default fixture deadline is
30 days later and reception 60 days later. This anchor is not an attempted future
expiry extension: the RSVP clock is fixed independently of the real calendar.
Each test resets its DI clock. No Date mocking, process clock change, session
clock override or cross-application provider mutation is used. Tests remain
sequential within the file and fixture IDs remain randomized.

Added HTTP/DB boundary cases at cutoff -1 ms, cutoff exactly and cutoff +1 ms;
the first two must persist a decline and the latter must return the deadline
error with no RSVP or CheckinPass writes. The existing after-deadline case uses
testNow -1 ms. Existing stale-version and eligibility tests now run before the
fixture deadline and retain their original 409/422 expectations. Existing accepted
pass issuance, accepted update, decline revocation and reaccept/new-pass assertions
remain. Two setup assertions now fail immediately on unsuccessful acceptance.
No lifecycle, cutoff policy, validation ordering, authorization or production
code was modified.

## Route difference and security

The exact additional routes are:

- GET /api/admin/event-management
- POST /api/admin/event-management
- PUT /api/admin/event-management/:eventId

They are declared in events/event-management.controller.ts, contract-locked in
docs/EVENT-MANAGEMENT.md, and present in OpenAPI and the generated client. All
three carry class-level AdminRoles(OWNER). They are distinct from the staff
active-event picker GET /api/admin/checkin/events; no staff permission was added.
Existing Phase 10 staff access remains limited to its explicit allowlist.

The global guard authenticates before handler lookup, enforces role and forced
password change, then requires Origin/CSRF for POST/PUT. The inventory now lists
all 48 routes exactly and includes the two new unsafe routes in its shared
missing-CSRF/wrong-CSRF/bad-Origin loop. All non-login routes remain in its
unauthenticated loop. OWNER Event Management GET is included in successful read
checks. A new real HTTP/DB test requires 403 FORBIDDEN for all three routes for
CHECKIN_STAFF and a mustChangePassword OWNER. Existing event-management HTTP
tests cover OWNER create/save and staff denial. These assertions are prepared,
not claimed executed successfully without PostgreSQL.

Compiled AppModule metadata enumeration (without app.init/listen or database
lifecycle) confirms the following exact 48 routes. Every method/path matches
OpenAPI, every path exists in the generated client, and resolved role metadata
matches the intended boundary. Login is deliberately unauthenticated; its default
metadata is not interpreted as a login authorization guard.

```text
DELETE /api/admin/event-content/:eventId/assets/:assetId
DELETE /api/admin/invitees/:inviteeId
GET /api/admin/auth/me
GET /api/admin/checkin/events
GET /api/admin/checkin/search
GET /api/admin/dashboard
GET /api/admin/event-content/:eventId
GET /api/admin/event-content/:eventId/assets/:assetId
GET /api/admin/event-management
GET /api/admin/events
GET /api/admin/invitations
GET /api/admin/invitations/:invitationId
GET /api/admin/invitations/:invitationId/messages
GET /api/admin/invitations/:invitationId/public-url
GET /api/admin/messages
GET /api/admin/reports/export
GET /api/admin/reports/households
GET /api/admin/reports/summary
GET /api/admin/rsvps
GET /api/admin/rsvps/:rsvpId
GET /api/admin/staff
PATCH /api/admin/invitations/:invitationId
PATCH /api/admin/invitees/:inviteeId
PATCH /api/admin/messages/:messageId
PATCH /api/admin/staff/:staffId
POST /api/admin/auth/change-password
POST /api/admin/auth/login
POST /api/admin/auth/logout
POST /api/admin/checkin/confirm
POST /api/admin/checkin/manual-confirm
POST /api/admin/checkin/manual-status
POST /api/admin/checkin/validate
POST /api/admin/event-content/:eventId/assets
POST /api/admin/event-content/:eventId/hide
POST /api/admin/event-content/:eventId/publish
POST /api/admin/event-management
POST /api/admin/imports/guest/commit
POST /api/admin/imports/guest/validate
POST /api/admin/invitations
POST /api/admin/invitations/:invitationId/archive
POST /api/admin/invitations/:invitationId/invitees
POST /api/admin/invitations/:invitationId/regenerate-token
POST /api/admin/staff
POST /api/admin/staff/:staffId/reset-password
PUT /api/admin/event-content/:eventId
PUT /api/admin/event-management/:eventId
PUT /api/admin/invitations/:invitationId/events
PUT /api/admin/invitations/:invitationId/rsvp
```

## Initial verification and handoff (before Docker recovery)

| Command / check                                                                                                                          | Result                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| pnpm lint                                                                                                                                | PASS; API lint reran, four other tasks cached                                         |
| pnpm typecheck                                                                                                                           | PASS; API typecheck reran, four other tasks cached                                    |
| pnpm build                                                                                                                               | PASS; API build reran, four other tasks cached; existing TikTok Sans warning replayed |
| pnpm deploy:test                                                                                                                         | PASS, 14 tests, no skips                                                              |
| Compiled admin route metadata / OpenAPI / client comparison                                                                              | PASS; static registration evidence, not HTTP authorization proof                      |
| Focused vitest command for public-invitation.http.integration.spec.ts and admin-read.http.integration.spec.ts with --no-file-parallelism | BLOCKED; command exit 1 at DB safety global setup                                     |
| pnpm --filter api test                                                                                                                   | BLOCKED; command exit 1 at DB safety global setup                                     |
| pnpm test                                                                                                                                | BLOCKED overall; API exit 1 at same guard, non-API suites run                         |
| Real PostgreSQL assertions                                                                                                               | NOT RUN; no isolated database could be started                                        |
| docker version                                                                                                                           | FAIL; dockerDesktopLinuxEngine named pipe missing                                     |
| Container smoke                                                                                                                          | NOT RUN; Docker unavailable, no relevant infrastructure edit                          |
| Git diff --check                                                                                                                         | PASS                                                                                  |

The guard error is: `Refusing database tests: set INVITATION_DATABASE_TESTS=1 and
use an isolated local invitation test/QA database. Development and production
databases are forbidden.` It was not bypassed. No DB migration/reset, Docker
repair, volume deletion, staging/production connection, or authentication bypass
was performed. Windows Docker failure is an environment blocker, not proof the
new assertions pass.

The existing GitHub-hosted Linux validate job already supplies ephemeral
postgres:18 invitation_ci, the opt-in flag, migrations and full API/root tests.
No workflow changes or failure suppression were made. Run that job on the reviewed
patch after an authorized commit/push. Historical failed CI is evidence of the
reported baseline, not a result for this uncommitted patch.

Changed files: the two named API integration specs, plus this new report.
Ignored local scripts/logs under .local-daily are private evidence, not source
files to commit. Business sources, Phase 10C/D/manual-status logic, Prisma
schema/migrations, Coolify production files, workflow and Figma PNGs are preserved.
Recommendation: review the test-only diff, but require Linux real PostgreSQL CI
success before merge. No claim of a green independent CI run or runtime closure.

## Resumed verification after Docker restart

The user reopened Docker. `docker version` now reports Docker Desktop 4.97.0,
Engine 29.9.2 with a Linux amd64 server. No Docker/WSL reset or data repair was
performed by the agent.

A new disposable container `invitation-qa-closure-cbfa0a3b` ran official
PostgreSQL 18.6 on Linux amd64. Before migration, a live SQL identity query
verified `current_database() = invitation_ci`, `current_user = postgres`, and
PostgreSQL 18.6. The DB lived in tmpfs with a random synthetic password and a
random loopback-only host port. No development, staging or production database
was reused. The existing database safety guard remained enabled, with the
explicit QA-only `INVITATION_DATABASE_TESTS=1` opt-in.

| Executed command                                                                                                                                                 | Result                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| pnpm db:migrate:deploy                                                                                                                                           | PASS; all 5 migrations applied to the new QA DB                                                        |
| pnpm db:status                                                                                                                                                   | PASS; database schema up to date                                                                       |
| pnpm --filter api exec vitest run src/invitations/public-invitation.http.integration.spec.ts src/admin/admin-read.http.integration.spec.ts --no-file-parallelism | PASS; 2 files, 28 tests                                                                                |
| pnpm --filter api test                                                                                                                                           | PASS; 40 files, 305 tests                                                                              |
| pnpm test                                                                                                                                                        | PASS; all 5 tasks succeeded; 856 tests across API 305, admin-web 312, invitation-web 232, api-client 7 |
| git diff --check                                                                                                                                                 | PASS                                                                                                   |

The 28 focused tests execute the fixed fixture through HTTP and real PostgreSQL,
including the inclusive deadline boundary, stale-version and eligibility errors,
CheckinPass issuance/revocation/reacceptance, exact route inventory, shared
session/CSRF/Origin checks, and the new staff/forced-password rejection case.
The full API suite also reran Phase 10 authentication, check-in, manual status
and database constraint regressions. No DB tests were skipped or mocked.

The first resumed attempt migrated a different disposable QA container but its
local orchestration script failed when saving a Windows filename containing
colons. That container was cleaned up. Only the ignored local log filename was
corrected before the successful full run; application/test expectations were
not changed during this retry. Successful private logs are in ignored
`.local-daily/invitation-qa-closure-cbfa0a3b/`.

Cleanup checked the exact QA ownership label, removed only that disposable
container, and discarded its tmpfs database. The migration history in source and
all existing Docker volumes were preserved. Existing lint/typecheck/build PASS
results above remain applicable because the resumed run changed only this report
and an ignored local orchestration script.

The initial local database blocker is now closed. Recommendation: READY_FOR_REVIEW;
require the existing GitHub-hosted Linux CI to succeed on the eventual reviewed
commit before merge. Nothing was staged, committed, pushed or merged, and no
production deployment or unrelated infrastructure verification was performed.
