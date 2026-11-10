# Phase 4A Admin UX and functional readiness

Reviewed on 11 November 2026 against master `b4ee00f` and the focused Phase 4A patch.

## Evidence boundaries

All new mutations ran against a disposable local PostgreSQL 18.6 container with database `invitation_qa_phase4a`. Repository database-safety guards were enabled. Browser credentials, guests, events and locations were synthetic fixtures. Production behavior and production records were outside this verification.

Skill discovery found no installed frontend-design, accessibility or Playwright skill. The available Windows Computer Use skill was inspected for applicability. Windows UI automation was unnecessary for these repository browser tests. The design process used the existing editorial tokens, explicit task ordering, before-and-after browser captures, keyboard tests and the already-installed axe-core engine. No design skill execution is claimed.

## Reproduced causes and design decisions

- **Check-in page architecture.** The original page placed its heading, email, account links, logout button and workspace directly into `.admin-shell`, whose desktop grid reserves a 248px sidebar column. The 1280px baseline screenshot shows account actions and the workspace scattered across grid rows. The page now has one bounded operational canvas with a compact header and a single workspace. OWNER dashboard navigation remains conditional, and existing server session and forced-password-change guards remain in place.
- **Unnecessary event choice.** The authorized Check-in event response was displayed without selecting its sole entry. Exactly one returned eligible event is now selected automatically. Zero events still block operations and multiple returned events still require a choice. No new event is created and authorization remains server-owned.
- **Deadline precision and timezone.** The create form used `datetime-local` with `step="0.001"`. Separate native date and minute-precision time controls now display Asia/Jakarta / WIB and require either both fields or neither. The existing strict `deadlineToIso` conversion remains the serializer. For example, `2027-01-02 00:30 WIB` becomes `2027-01-01T17:30:00.000Z`. Existing edit-form precision and backend date semantics remain available. A selected deadline minute means that exact instant, with the backend's inclusive cutoff behavior.
- **Names and attendance allowances.** The first named guest supplies the default invitation name. Optional household naming and greeting text have separate explanations. Each named guest occupies one explicit row, plus-one remains a maximum of one, and additional children are distinct from named children. The summary now shows completed named guests, greeting, invitation name, event name and deadline. A household label never implies arbitrary group capacity.
- **Content-width reflow.** The desktop create layout used a minimum 280px review column based solely on viewport breakpoints. At 200% CSS zoom its field column could collapse. A scoped container query stacks the two create columns when their actual available width is narrow. The final regression preserves the same width assertions and reachable controls.
- **Operator feedback.** Check-in now orders event context, QR or household search, validation preview, expected/actual attendance, explicit confirmation and recovery. Result transitions receive keyboard focus and scroll into view. The one-confirmation limit is visible before scanning and next to confirmation. QR decoding and validation never confirm attendance automatically.

Creation's in-flight guard, non-secret pending marker, uncertain-outcome lock, explicit recovery, server-confirmed receipt and sharing controls retain their existing behavior. Check-in's generation guard, explicit confirmation, atomic backend guard and exact-target recovery remain in place.

## RSVP integrity audit

The public form and server action use the generated contract, with `expectedVersion`, status, attendee rows, event selections and `dietaryNotes`. DTO mapping rejects unsupported top-level properties. `PublicRsvpService` locks the invitation before checking the persisted deadline, version, attendance permissions and existing Check-in. Successful writes update RSVP, attendees, selections and pass lifecycle in one transaction. Admin reads project persisted data with OWNER authorization.

| Assertion                                        | Current evidence                                                                                                  | Classification |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| Fresh invitation has no submitted RSVP           | HTTP integration and new real Admin-create journey verify `rsvp=null` / zero persisted RSVP rows                  | TESTED         |
| Accepted, declined and edited RSVP persist       | Public service and HTTP tests, plus real guest submit and subsequent reload                                       | TESTED         |
| Named guests and quantities                      | Named invitees belong to this invitation, are unique and have quantity one                                        | TESTED         |
| Event counts and eligibility                     | Event selection validation rejects ineligible events and invalid counts                                           | TESTED         |
| Plus-one and children limits                     | Locked invitation allowances are enforced independently of display names                                          | TESTED         |
| Deadline and version conflicts                   | Inclusive deadline boundary, stale/null versions and concurrent first writes/updates                              | TESTED         |
| QR issuance and revocation                       | Accept issues one active pass, accepted edits retain it, decline revokes it, re-accept issues a new pass          | TESTED         |
| Check-in lock and races                          | Public RSVP locks after Check-in, with real PostgreSQL invitation-lock ordering and concurrent confirmations      | TESTED         |
| OWNER override                                   | Deadline exception requires OWNER authorization and a reason, preserves other constraints and records attribution | TESTED         |
| Actual deployed RSVP and current production data | No production business acceptance was performed in this task                                                      | NOT VERIFIED   |

`RSVP.guestNote` is a separate nullable persisted schema field. The current public request DTO does not accept it. Admin RSVP detail reads it, while current public and OWNER RSVP mutations preserve an existing value. The tests explicitly protect this behavior. `dietaryNotes` is the supported RSVP dietary text with its existing validation and clear-on-decline behavior. Standalone `GuestMessage` rows are separate records. This patch adds no RSVP comment input.

Source evidence includes [public form](../apps/invitation-web/components/invitation/public-rsvp-form.tsx), [RSVP DTO](../apps/api/src/invitations/dto/public-rsvp.dto.ts), [transaction service](../apps/api/src/invitations/public-rsvp.service.ts), [schema](../apps/api/prisma/schema.prisma), [Admin projection](../apps/api/src/admin/admin-read.service.ts), [Admin detail](../apps/admin-web/components/rsvp-detail.tsx), [service tests](../apps/api/src/invitations/public-rsvp.service.spec.ts), [HTTP tests](../apps/api/src/invitations/public-invitation.http.integration.spec.ts), [OWNER override tests](../apps/api/src/admin/admin-rsvp.http.integration.spec.ts) and [Check-in concurrency tests](../apps/api/src/checkin/checkin.http.integration.spec.ts).

## Guest-message integrity audit

| Assertion                      | Current evidence                                                                                                                                          | Classification                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Persistence and ownership      | Atomic insert resolves an active invitation from the hashed public credential, HTTP tests and real browser journey inspect PostgreSQL                     | TESTED                                               |
| Author and message validation  | Optional trimmed author, maximum 100 Unicode code points, required trimmed message, maximum 1000 code points, unknown fields rejected                     | TESTED                                               |
| Repeated explicit submits      | Two submits intentionally create two distinct append-only rows                                                                                            | TESTED                                               |
| Lost response                  | Client makes one POST, reports an uncertain outcome and never retries automatically. A subsequent explicit submit can still duplicate a committed message | STATICALLY VERIFIED and covered by client unit tests |
| Admin list and moderation      | OWNER global/scoped reads and idempotent hide/unhide preserve content and invitation ownership                                                            | TESTED                                               |
| Safe guest text rendering      | Admin renders message text through React text nodes. Existing browser moderation tests include hostile text coverage                                      | TESTED and STATICALLY VERIFIED                       |
| Application message rate limit | No dedicated throttle, CAPTCHA or idempotency enforcement was found on this public POST path                                                              | STATICALLY VERIFIED gap                              |
| Edge abuse controls            | Coolify, CDN and production edge configuration were not audited here                                                                                      | NOT VERIFIED                                         |
| Public feed                    | The supported public route is POST-only. Visibility is an internal moderation flag and does not publish a guest wall                                      | STATICALLY VERIFIED                                  |

Sources include [public form](../apps/invitation-web/components/invitation/guest-message-form.tsx), [network wrapper](../apps/invitation-web/src/server/public-guest-message.ts), [request DTO](../apps/api/src/messages/dto/public-guest-message.dto.ts), [controller](../apps/api/src/messages/public-guest-message.controller.ts), [insert service](../apps/api/src/messages/public-guest-message.service.ts), [Admin rendering](../apps/admin-web/components/message-list.tsx), [service tests](../apps/api/src/messages/public-guest-message.service.spec.ts), [HTTP tests](../apps/api/src/messages/public-guest-message.http.integration.spec.ts), [moderation tests](../apps/api/src/admin/admin-guest-message.http.integration.spec.ts) and [privacy contract](API-CONTRACT.md).

## Separate product and database backlog

| Priority | Item                                | Required contract decision                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | Message lost-response deduplication | Define a per-submission idempotency key scoped to invitation, request fingerprint and retention period. A transaction and unique key must return the same minimal acknowledgement for the same payload, reject key reuse with different payload, and allow a deliberate new message with a new key. This requires an approved API/storage change. Never deduplicate by message text alone. |
| P1       | Message spam protection             | Approve privacy-preserving per-invitation and operator-trusted client limits, bounded storage, safe 429 behavior and edge coverage. Never log a bearer credential.                                                                                                                                                                                                                         |
| P1       | Later arrivals and corrections      | Decide whether attendance is a single final count or an auditable arrival/correction ledger. Preserve attribution, uniqueness, concurrency and RSVP locking. The current interface explains the single-record limitation.                                                                                                                                                                  |
| P2       | RSVP guest note                     | Decide whether `guestNote` should ever become guest-writable, with explicit DTO, limits, visibility and privacy rules. Existing dietary notes and messages already have distinct contracts.                                                                                                                                                                                                |

These are separate review items. No backend, schema, migration, API-contract or moderation change is included in this patch.

## Visual and functional verification

Before-and-after browser captures cover both create and Check-in at 320, 375, 412, 768, 1024, 1280 and 1440 CSS pixels. Each final page has zero horizontal overflow. The captures use synthetic fixture identities. Local evidence is retained in `phase4a-20261111/before` and `phase4a-20261111/after` in the task's artifact workspace, with geometry JSON alongside them. These screenshots are delivered separately from repository source.

The browser regressions cover visible labels, date/time validation, keyboard focus, optional controls, submit reachability, sole-event selection, confirmation remaining explicit and uncertain-create locking across reload. CSS zoom 125% and 200% reflow was verified at a 1280px browser viewport, alongside the existing 200% text-enlargement test. Native browser/OS zoom and physical venue camera hardware remain unverified.

Axe-core WCAG A/AA checks reported zero violations for both screens at 375 and 1280px. Four desktop preview text nodes required manual contrast review over photography. Their computed foreground is white at full opacity over `rgba(15,32,43,0.9)`. Even a white underlying image gives a worst-case contrast of approximately 12.40 to 1. This bounded check does not claim a complete accessibility certification.

Final local results are recorded below. An earlier harness invocation used the repository root instead of the Admin application's working directory, making relative import fixtures unavailable. The accepted full run used the standard package command and fresh mock servers. Four role tests initially assumed every navigation landmark was OWNER navigation. They now explicitly forbid Primary navigation for staff and assert that Operator account contains only Change password and Sign out. Existing OWNER-data, forced-change, redirect-loop and authorization assertions remain enforced.

| Gate                                                                                                                   | Result                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm --filter admin-web test`                                                                                         | 24 files, 337 tests PASS                    |
| Focused API Vitest run covering RSVP service/public HTTP, OWNER RSVP, message DTO/service/HTTP/moderation and Check-in | 8 files, 72 PostgreSQL-backed tests PASS    |
| `pnpm --filter admin-web exec playwright test`                                                                         | Full suite, 146 PASS, zero retries          |
| `pnpm --filter admin-web exec playwright test --config=playwright.journey.config.ts`                                   | 15 real-backend journeys PASS, zero retries |
| `pnpm --filter admin-web lint`                                                                                         | PASS                                        |
| `pnpm --filter admin-web typecheck`                                                                                    | PASS                                        |
| `pnpm --filter admin-web build` with isolated `.next-journey` build output                                             | PASS                                        |
| Final formatting, source-link and diff checks                                                                          | PASS                                        |

The new real journey signs in as OWNER, creates exactly one invitation through the form despite a double click, checks its exact persisted UTC deadline and initial RSVP absence, opens its returned personal URL at 375px, submits an RSVP and verifies the saved state after reopening. Existing real journeys cover messages, true QR decoding, explicit confirmation, lost-response recovery, duplicate prevention and session/RBAC boundaries.

The existing TikTok Sans fallback-metrics warning remains visible during development/build and is separate from these changes. Final Git and hosted CI status are recorded in the PR handoff. The local verdict is **GO for OWNER and PR review**. Production acceptance remains a separate OWNER-controlled step. Require visual review and normal hosted CI before merge, then a separately approved production release and controlled live business smoke test.
