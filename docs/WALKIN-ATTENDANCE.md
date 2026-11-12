# Direct walk-ins and attendance corrections (Phase 4D)

This extends [registered guest reception](RECEPTION-WORKFLOW.md) for one wedding. OWNER and GUEST_MANAGER use `/reception`. No couple/OWNER approval is required for ordinary walk-ins, corrections or the bounded exception flow. CHECKIN_STAFF retains its legacy workspace and cannot call the new mutations or action-status endpoint. OWNER administration, credential delivery, event configuration and unrestricted RSVP history remain OWNER-only.

## Guest Assistance

1. Enter the lead guest/household identity and **Check existing guest list**. Search includes previous registrations and walk-ins, household/greeting/invitee names and printed HJ references.
2. Open an existing household when it matches. A physical card is a verification channel, not proof of an unregistered household.
3. For an unregistered household, attest that the list was checked. Review every potential match. If any match exists, a distinct-household reason is mandatory. More than 25 potential matches requires a refined name, not a truncated approval.
4. Enter arriving people, expected total, affiliation, verification and registration reason. Review and confirm once.
5. Read **Guest Registered & Checked In**, including the HJ reference, actual/expected/remaining people. View the household for later arrivals, return to reception or register another guest.

Name input is normalized with NFKC, whitespace folding and length limits (2–100 characters). Indexed case/punctuation/whitespace-normalized equality supplements the existing indexed name-prefix search. This is not fuzzy identity matching. Similar or identical names are not automatically rejected: an operator can explicitly distinguish unrelated households, with reason and the reviewed match IDs retained. Server-side duplicate validation is repeated inside the transaction. Walk-in registrations take an exclusive event lock, serializing competing registrations and coordinating with the existing invitation graph creator's event lock. An intervening match invalidates the previous review.

## Honest group representation

Initial walk-in groups are bounded to **1–25 expected people**, with **1–expected arriving now**. The known lead/household identification is retained as supplied; the graph has one lead invitee. The remaining people are one explicit `UNNAMED_COMPANION` RSVP attendee group and `unnamedCompanionAllowance`, not fabricated names, additional children or arbitrary plus-ones. No companion identities or ages are inferred. Ordinary public/OWNER RSVP mutation parsers retain their existing accepted attendee inputs; the new type is used by the validated internal walk-in lifecycle. Read projections and guest/OWNER summaries understand it. The first check-in still locks guest RSVP edits, even if attendance is later corrected to zero.

Registration origin (`WalkinRegistration` or previously registered) is separate from verification (`PHYSICAL_INVITATION`, `VERBAL_IDENTIFICATION`, `FAMILY_REFERENCE`, `OTHER`) and arrival method (`QR`/`MANUAL`). Affiliation is bride's family, groom's family, friend, colleague or other. Operational detail exposes the registration ID, lead/group counts, affiliation and duplicate distinction; linked action history exposes operator, role, reason, verification and server time. OWNER can inspect these via the reception workspace/API as well as the existing invitation, RSVP and attendance reports.

## Atomicity, credentials and recovery

One database transaction verifies the active account/event, duplicate review and bounds; reuses `createAdminInvitationGraph` and the existing HMAC credential implementation; allocates the HJ reference; links the event and lead; persists the Accepted on-site RSVP/pass and Phase 4B `ON_SITE_RSVP` history; invokes the shared Phase 4C arrival engine; and appends the registration/action receipt. Any failure rolls back the entire graph. No placeholder token hashes are used. Guest Managers receive no public URL, invitation credential, QR payload, hash, password or session material. OWNER credential delivery stays under the existing authorized mechanism.

Every walk-in, correction and exception has a persistent `ReceptionAction.operationId`. Transactional advisory locks serialize the operation UUID and actor. The fingerprint binds action kind, normalized command and actor; reviewed IDs are sorted. An identical retry returns the original receipt, even after later attendance changes. Different input, actor or kind conflicts. Phase 4C arrival operation identities remain supported and cannot be reused as a new action. Recovery is `GET /api/admin/reception/actions/:operationId`, read-only and available to the original actor or OWNER. A lost response freezes other reception actions until canonical status is checked; only an explicit resend of the same frozen operation is permitted. No blind retry or new UUID is generated after uncertainty.

Commands remain in memory. After browser close/reload or a lost session, search the household and examine canonical history before any new mutation. A recovered receipt describes the original operation, while refreshed detail/statistics describe current attendance. A disabled account or forced password change cannot operate. Existing CSRF/Origin/session checks apply to every mutation; services revalidate operator status/role under lock. A database-backed limit allows at most **30 newly committed walk-in/correction/exception operations per operator in a rolling minute**. Committed UUID replay is exempt, allowing recovery under that limit. Existing normal check-in protections remain unchanged.

## Corrections and exceptional people

For an eligible, already checked-in household, review actual counts and original arrival history. Select **Correct recorded total**, the arrival method being corrected, a verification method and a reason. Explicit confirmation applies a signed compensating action and changes the aggregate in one transaction. Original positive arrival rows are never changed/deleted. Effective attendance is:

`sum(original arrivals) + sum(correction deltas)`

The effective result must be between zero and operational expected capacity. QR/manual subtotals must each remain nonnegative. A revision derived from append-only arrivals and actions prevents stale/ABA updates and conflicting staff changes. The zero aggregate is retained, preserving the public RSVP lock and explaining a fully reversed count. Positive corrections restore previously miscounted people only within the capacity; they do not authorize a capacity increase. The reason/method remain auditable.

**Exceptional additional guests** is a separate mutation. It requires an existing Accepted, eligible household with a check-in record, current revision, verification and reason. It authorizes and immediately records **1–5 additional manual arrivals**, with **no more than five cumulative extra people per household/event**. The shared arrival engine includes that immutable operational capacity grant. It does not change the saved RSVP, its version, selected attendees or Phase 4B history. Extra capacity and its arrival roll back together on failure. Corrections do not erase or recycle an exceptional authorization; the five-person cumulative ceiling remains in effect. There is no arbitrary capacity-edit API.

## API

Existing Phase 4C endpoints remain supported. Added OWNER/GUEST_MANAGER-only operations:

| Method | Path                                        | Purpose                                                |
| ------ | ------------------------------------------- | ------------------------------------------------------ |
| POST   | `/api/admin/reception/walkins`              | Atomic register and first arrival                      |
| POST   | `/api/admin/reception/corrections`          | Set a verified effective total with compensating audit |
| POST   | `/api/admin/reception/exceptions`           | Bounded extra capacity and immediate arrival           |
| GET    | `/api/admin/reception/actions/:operationId` | Original operation receipt, no write                   |

OpenAPI and generated client define the exact shapes. Correction `count` is the desired effective total; exception `count` is additional arriving people. Requests require the current attendance revision; invalid counts/reasons/fields fail closed. Registered guest search/QR/arrival operations remain on the shared check-in engine.

## Reporting units

- `registeredHouseholds` excludes walk-ins; `walkinHouseholds` counts walk-in households. Pending/Accepted/Declined counts include all event-linked households.
- `registeredExpectedGuests` and `walkinExpectedGuests` count active Accepted expected **people**, including explicitly granted operational extras. Their sum is `expectedGuests`. Saved RSVP expectation is separately visible as `baseExpectedCount`.
- `arrivedGuests` is the sum of effective aggregates; `walkinArrivedGuests` is its walk-in subset. Original arrival rows are not counted twice through registration rows.
- Partial/completed are households with positive effective actual attendance below/at operational expected capacity. Corrected-to-zero households are not counted as arrived.
- QR/manual people are original method totals plus signed corrections for that method. `correctionOperations` counts correction **operations**; `exceptionalGuests` sums authorized additional **people**, not operation count.
- `onSiteConfirmations` counts Phase 4B audit actions; registering a walk-in produces one such action. Registering and arriving are not two guests.

Existing OWNER dashboard/report expected people include operational extras; actual people use the aggregate. Zero records retain history but are not arrived-household counts. CHECKIN export retains the historical aggregate row and first method/operator; it can show zero actual after correction. Mixed-method breakdown and correction provenance live in reception detail/statistics. Archived historical actuals remain available; active expectation excludes archived invitations, as before.

## Migration and rollback

Two additive migrations add the explicit companion type/allowance, append-only registration/action tables, and normalized name indexes. The aggregate constraint changes from positive to **nonnegative** solely to support a fully reversed attendance count; arrival rows retain their positive-count constraint. Historical migration files, references, RSVP/pass credentials and existing arrival rows are unchanged. The runtime application role cannot update/delete/truncate registration/action provenance; separate table-owner maintenance authority follows Phase 4B/4C's boundary.

Rehearsal clones a disposable PostgreSQL 18 Phase 4C fixture database and compares checksums of existing RSVP, pass, aggregate and arrival rows across both migrations. A fresh disposable database applies all migrations and checks schema parity. Production rollout still requires the existing verified backup, protected migration gate, immutable images, OWNER approval and health checks. This task performs no production migration or deployment.

Do not down-migrate, reset data or delete provenance for rollback. Older applications may not understand unnamed companion rows or zero aggregates. Pause reception writes and use a compatible application/forward repair, retaining all audit evidence. Back up before rollout; restore only through the approved recovery procedure and an explicit data-loss decision. Initial group size and the five-person exception limit are fixed server policies in this release. There is no walk-in delete, approval queue, unrestricted allowance editor, capacity-grant reversal or correction-history rewrite.
