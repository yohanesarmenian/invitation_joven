# Open Questions

Only material unresolved questions that affect product, architecture, database, API, UI behavior, or implementation gates are listed here. Do not fill these gaps by assumption during implementation.

Resolved by Phase 0D and no longer open:

- Known spouse representation: normal named Invitee.
- Known child representation: normal named Invitee.
- Optional unnamed adult companion: `PLUS_ONE`.
- Optional unnamed/additional children: `ADDITIONAL_CHILD`.
- `Invitation.max_additional_children` applies only to unnamed/additional children.
- Attendance source-of-truth separation: `InvitationEvent`, `RSVPEventSelection`, `RSVPAttendee`, and `CheckinRecord`.
- Public invitation/check-in credential redisplay: deterministic server derivation.
- Check-in uniqueness: confirmed attendance is unique by `Invitation + Event`.
- Archive behavior: public/RSVP/message/check-in denied; OWNER history retained.

## Resolved by Phase 5 Slice 5B0

Owner decisions locked for Phase 5. These are now authoritative; do not re-litigate them during implementation.

- RSVP cutoff value — Decision: cutoff is `25 December 2026, 23:59:59 Asia/Jakarta (WIB, UTC+7)`, equivalent instant `2026-12-25T16:59:59Z`, held in the persisted `Invitation.rsvpDeadlineAt`. Date/phase: 2026-09-29, Phase 5 Slice 5B0. Consequence: the Figma deadline value `25 December 2027` is Figma-stale and superseded; it must not be treated as application truth. The displayed wedding date `09 January 2027` is unchanged, and the cutoff now precedes it, so no chronological inconsistency remains. Phase 4 public copy needs no change.
- Public create/update cutoff behavior — Decision: public RSVP create and update are both allowed up to and including the cutoff instant and both rejected afterwards with `422 RSVP_DEADLINE_PASSED`. Public invitation GET remains available after the cutoff. Date/phase: 2026-09-29, Phase 5 Slice 5B0. Consequence: Phase 4's read-only behavior is unaffected; Phase 5 must enforce the cutoff in the RSVP transaction before applying state.
- OWNER post-deadline override — Decision: not defined or implemented in Phase 5, and no public override behavior may be invented. Date/phase: 2026-09-29, Phase 5 Slice 5B0. Consequence: any future OWNER override must be a separate authenticated admin contract.
- First-mutation `expectedVersion` — Decision: `expectedVersion` is `integer | null`. `null` is create-only and conflicts if an RSVP row exists at lock time; an existing RSVP requires the exact persisted `version`, otherwise `409 RSVP_VERSION_CONFLICT`. Initial persisted `version = 1`; each successful mutation increments it. Date/phase: 2026-09-29, Phase 5 Slice 5B0. Consequence: RSVP rows are created lazily; no empty/`PENDING` row is pre-created to manufacture a version.
- Accepted-event minimum — Decision: an `ACCEPTED` RSVP must select at least one eligible attending event. Zero attending events returns `422 EVENT_NOT_SELECTED`; no new error code is introduced. Date/phase: 2026-09-29, Phase 5 Slice 5B0. Consequence: the existing event-selection error code now explicitly covers the zero-event case.
- Dietary semantics — Decision: `RSVP.dietaryNotes` is household-level, optional, trimmed, maximum 500 characters after trimming, empty-after-trim becomes `null`, and is cleared to `null` on decline. Date/phase: 2026-09-29, Phase 5 Slice 5B0. Consequence: the 500-character maximum is documented consistently in the API and UI contract areas.
- Phase 5 vs Phase 6 pass boundary — Decision: Phase 5 implements only the minimal `CheckinPass` data lifecycle required for RSVP transactional consistency (accepted holds exactly one active pass, decline revokes, re-accept issues a new pass). Phase 6 owns QR rendering, QR presentation, the QR-centric confirmation UX, and later pass/check-in presentation. Date/phase: 2026-09-29, Phase 5 Slice 5B0. Consequence: Phase 5 is not a QR implementation and must not ship QR UI.

## Resolved by Phase 6 Slice 6B0

Guest check-in pass / QR contract decisions for Phase 6. These are now authoritative; do not re-litigate them during Phase 6 implementation.

- QR payload wire format (D2) — Decision: `qrPayload` is the **bare opaque derived check-in credential** produced by the existing credential derivation for namespace `check-in` with `CheckinPass.id` as stable id and `CheckinPass.credentialVersion` as version. It is an unpadded Base64URL string. It is not a URL, not `/c/<credential>`, not `/api/public/checkin/<credential>`, not a JWT, not JSON, not prefixed, not an internal UUID, not `tokenHash`, and not `credentialVersion`. The QR image encodes the credential string itself. Date/phase: 2026-09-30, Phase 6 Slice 6B0. Consequence: no schema or storage change is needed for QR display, because the credential is deterministically re-derivable; no credential-bearing public route is introduced; the lexical format is not the security boundary and server-side validation remains authoritative.
- Declined confirmation behavior (D4) — Decision: Phase 6 creates no new declined flow. It reuses the current Phase 5E declined confirmation: the existing notice is shown, no QR is rendered, and no pass credential or pass metadata is displayed. Guests may still edit their response before the deadline under the existing RSVP rules. Date/phase: 2026-09-30, Phase 6 Slice 6B0. Consequence: the declined confirmation copy remains whatever the implementation defines (`apps/invitation-web/src/rsvp/notice.ts`), and final copy polish stays a separate copy decision rather than being invented during pass work.
- Guest pass presentation surface (D5) — Decision: the guest QR/pass is presented **inline within the existing public RSVP/result surface** on the invitation long page. Phase 6 introduces no dedicated pass route, no `/c/...` route, no separate guest portal, and no navigation to another public page. The Figma `Registered` state is a visual reference, not a routing requirement. Date/phase: 2026-09-30, Phase 6 Slice 6B0. Consequence: any later focused presentation state must still be hosted inside the existing invitation flow unless a future contract explicitly changes routing.

## Resolved by Phase 7 Slice 7B0

Guest message contract decisions for Phase 7. These are now authoritative; do not re-litigate them during Phase 7 implementation.

- **D1 — Retry / idempotency / duplicate semantics** — Decision: guest messages are **create-only append** operations. Every explicit successful submission creates a new `GuestMessage` row, and multiple messages from the same invitation are allowed. There is no idempotency key, no unique message-per-invitation rule, no optimistic version, no update-on-duplicate behavior, and no automatic retry. The frontend disables submit while a submission is pending and must not automatically retry the `POST` when the network outcome is uncertain. A guest may explicitly submit again; an explicit second submission is a new message and may duplicate if the earlier uncertain request actually committed. Date/phase: 2026-09-30, Phase 7 Slice 7B0. Consequence: **no schema change and no migration** — no idempotency column and no unique constraint are added. This closes the previously open "Guest message retry/idempotency" question.
- **D2 — Message content contract** — Decision: `message` is required, plain text only, trimmed of leading and trailing whitespace before persistence, rejected if empty after trimming, and limited to a maximum of **1000 Unicode characters after trimming**. Internal line breaks are preserved; Unicode and emoji are allowed. HTML is not interpreted, Markdown is not interpreted, links are not auto-converted to HTML, and the value must never be rendered with `dangerouslySetInnerHTML`. The stored value is the trimmed plain-text message, and rendering layers rely on normal text escaping. No HTML sanitizer dependency is added, because rich text is not part of the contract. Date/phase: 2026-09-30, Phase 7 Slice 7B0. Consequence: length and trimming are enforced at the DTO/application boundary; no database `CHECK` constraint is required for the MVP, and the previously deferred "length limits to be set during implementation" is now resolved.
- **D3 — Submission window** — Decision: guest message submission is **independent of RSVP existence, RSVP status, and `rsvpDeadlineAt`**. A message may be submitted whenever `Invitation.status` is `ACTIVE`, including when no RSVP exists, the RSVP is `ACCEPTED` or `DECLINED`, or the RSVP cutoff has passed. Submission is denied when the invitation is `ARCHIVED` or otherwise unavailable through the public credential boundary. Date/phase: 2026-09-30, Phase 7 Slice 7B0. Consequence: no `MESSAGE_DEADLINE_PASSED` code is introduced and `RSVP_DEADLINE_PASSED` is never reused for guest messages. The RSVP cutoff closes RSVP create/update only.
- **D4 — Author identity** — Decision: `authorName` is **optional guest-entered free text**. It is trimmed, empty after trimming becomes `null`, and the maximum length after trimming is **100 Unicode characters**. Unicode and emoji are allowed; content is plain text only. It is never derived from `Invitee`, `Invitation.greetingName`, or `RSVP`. Anonymous submission (`authorName: null`) is valid, and `GuestMessage` carries no public identity or account semantics. Date/phase: 2026-09-30, Phase 7 Slice 7B0. Consequence: no `inviteeId`, no author household id, and no account linkage are added; the existing nullable `author_name` column is already sufficient.
- **D5 — Public CRUD and response shape** — Decision: the Phase 7 public guest-message API is **create-only**: `POST /api/public/invitations/{publicCredential}/messages`. There is no public message list, no get-by-id, no update, no delete, and no public message wall. **`GuestMessage.id` is internal and is never returned publicly.** The public success response is `201 Created` with `{ "message": { "createdAt": "<ISO-8601>" } }` only. Date/phase: 2026-09-30, Phase 7 Slice 7B0. Consequence: this deliberately changes the earlier draft response, which returned `message.id`; the public client has no functional need for the row id, so an internal UUID is not exposed merely because it exists. Admin read and moderation remain Phase 8+.
- **D6 — Error contract** — Decision: **no new `MESSAGE_*` domain error codes** are introduced. Invalid request content returns the existing `400 VALIDATION_ERROR` envelope; unknown credentials, unavailable invitations, and archived invitations return the existing generic `404 INVITATION_NOT_AVAILABLE` without revealing which case occurred; unexpected failures use the existing generic server-error behavior. Error responses never echo message content, `authorName`, the public credential, or database IDs. Date/phase: 2026-09-30, Phase 7 Slice 7B0. Consequence: no new error envelope and no message-specific error code. Admin listing pagination, sort order, detail, and hide/unhide are **not** Phase 7 blockers and remain open for Phase 8+; no admin sort order is locked here.
- **D7 — Abuse / rate-limit posture** — Decision: Phase 7 introduces **no** CAPTCHA, Turnstile, Redis, Nest throttler, application rate-limit dependency, or new edge/proxy infrastructure. Mitigation is intentionally limited to the bearer public invitation credential, the `ACTIVE` invitation requirement, the 1000-character message cap, the 100-character `authorName` cap, strict DTO validation, submit-disabled-while-pending, no automatic `POST` retry, the generic unavailable response, and invitation-scoped writes. Repeated deliberate submissions remain possible; this is an **accepted MVP limitation**. Date/phase: 2026-09-30, Phase 7 Slice 7B0. Consequence: deployment/edge-level rate limiting is recommended before production exposure if abuse becomes a concern, and Phase 7 does not depend on infrastructure that does not exist in this repository.

## Phase-Blocking Questions

### Post-check-in RSVP mutation policy

- Question: may a household that has already been checked in for an event still submit a new RSVP that changes its status or counts?
- Why it matters: `CheckinRecord` and `RSVP` are independent rows with no mutual constraint. The Phase 5 mutation path never reads `CheckinRecord`, and the decline path revokes the pass without touching any existing `CheckinRecord`, so a checked-in household could currently decline and leave a confirmed attendance row behind.
- Impacted components/documents: Technical Architecture, API Contract, Database Schema, RSVP service, Phase 10 check-in implementation.
- Blocking phase: Phase 10 check-in implementation. **Does not block Phase 6**, which creates no `CheckinRecord`.
- Possible choices: allow and treat check-in as a historical fact; block post-check-in RSVP mutation with a new domain error; allow but flag the household for operator attention.
- Status: Unresolved. Phase 6 does not alter Phase 5 RSVP mutation semantics. This must be decided before Phase 10 implementation.

### Wedding date and RSVP deadline conflict

- Status: RESOLVED in Phase 5 Slice 5B0. The RSVP deadline is `25 December 2026, 23:59:59 Asia/Jakarta` (`2026-12-25T16:59:59Z`), which precedes the displayed wedding date `09 January 2027`. The Figma value `25 December 2027` is Figma-stale and superseded. See "Resolved by Phase 5 Slice 5B0" above.
- Historical context: Figma displayed the wedding date as `Saturday, 09 January 2027` and the RSVP deadline as `25 December 2027`, which was chronologically inconsistent because the deadline fell after the wedding date.
- Residual: final wedding copy confirmation remains tracked under "Final wedding copy" below.

### RSVP deadline/update cutoff behavior

- Status: RESOLVED in Phase 5 Slice 5B0. Public create and update both close at the cutoff instant with `422 RSVP_DEADLINE_PASSED`; public GET stays open; no public override exists. See "Resolved by Phase 5 Slice 5B0" above.
- Historical context: the question was whether guests could update RSVP after the deadline themselves or only through the OWNER.
- Residual: whether an authenticated OWNER post-deadline override is ever added remains undecided, but it is explicitly out of Phase 5 scope.

### Final admin auth deployment topology

- Question: What exact production same-site/origin topology will admin-web and api use?
- Why it matters: Cookie attributes, CSRF issuance/recovery, allowed credentialed origins, logout cookie clearing, and expired-session cleanup depend on deployment topology.
- Impacted components/documents: Technical Architecture, API Contract, admin auth implementation, deployment.
- Blocking phase: Phase 8 before admin auth ships. Does not block Phase 1 repository foundation.
- Possible choices: same origin behind one host, same site different subdomains, or explicitly configured cross-origin admin/API deployment.
- Status: Unresolved.

### First admin OWNER bootstrap

- Question: how is the first `AdminUser` — with a usable `passwordHash` — created in a fresh environment?
- Why it matters: the repository currently has **no** supported first-admin bootstrap mechanism. There is no seed script, no user-creation endpoint or CLI, and no password-hashing dependency anywhere in the repository; `AdminUser.passwordHash` has no writer. A deployed environment therefore cannot create its first OWNER without direct database manipulation.
- Impacted components/documents: Technical Architecture, API Contract, admin auth implementation, deployment runbook.
- Blocking phase: Phase 8 (admin authentication). Explicitly out of Phase 6 scope; Phase 6 must not introduce admin auth or bootstrap logic.
- Possible choices: a CLI/seed script reading credentials from environment configuration; a one-time setup endpoint gated on an empty `admin_users` table; documented manual SQL.
- Status: Unresolved.

### Parking Guide behavior

- Question: What should the Parking Guide action open or show?
- Why it matters: Figma contains the control but not the production behavior.
- Impacted components/documents: UI/UX Spec, Public Invitation API if dynamic content is needed, asset planning.
- Blocking phase: Phase 4 only if Parking Guide is implemented then; otherwise before the parking feature ships.
- Phase 4 impact: blocks only a functional Parking Guide action. Phase 4 must not invent a link, modal, PDF, image, map destination, or separate page.
- Possible choices: image, modal, PDF/document, map destination, separate page.
- Status: Unresolved.

### Final wedding copy

- Question: What is the final production copy for names, greetings, event wording, verse, closing, and footer credits?
- Why it matters: Implementation must not fabricate final wedding content.
- Impacted components/documents: UI/UX Spec, public invitation frontend.
- Blocking phase: Phase 4 for final content lock; not a repository foundation blocker.
- Phase 4 impact: blocks final content/polish, not the route, data flow, or read-only structure. Preserve design content as reference and mark final copy as pending where needed.
- Possible choices: Use finalized owner-provided copy or preserve Figma copy after explicit approval.
- Status: Unresolved.

### Final assets and envelope animation cuts

- Question: Which final images and separated envelope/floral assets are approved for production?
- Why it matters: Figma-flattened artwork may not map directly to responsive animation assets.
- Impacted components/documents: UI/UX Spec, public invitation frontend, asset pipeline.
- Blocking phase: Phase 4 for final visual implementation; placeholder implementation may proceed only if explicitly approved.
- Phase 4 impact: blocks visual fidelity and may block final high-fidelity envelope animation. Does not block Slice 1 retrieval shell.
- Possible choices: export separated assets from Figma, provide production image set, or simplify animation with approved static layers.
- Status: Unresolved.

### Invitation link regeneration retry/idempotency

- Question: What deterministic retry/idempotency behavior should the regenerate-link endpoint provide if the admin loses the response?
- Why it matters: Regeneration increments credential version and invalidates old links; ambiguous retries could rotate more than intended.
- Impacted components/documents: API Contract, invitation service, admin UI.
- Blocking phase: Before regenerate endpoint ships, likely Phase 8.
- Phase 4 impact: non-blocking.
- Possible choices: explicit idempotency key; confirm modal plus response recovery; no automatic retry by client.
- Status: Unresolved.

### Import preview lifetime and idempotent commit semantics

- Question: How long does an import preview remain valid, and how is duplicate commit prevented if an admin retries?
- Why it matters: Preview storage, commit safety, and admin retry behavior depend on this.
- Impacted components/documents: API Contract, imports module, admin import UI.
- Blocking phase: Phase 9 before import implementation.
- Phase 4 impact: non-blocking.
- Possible choices: short-lived persisted preview; signed temporary preview token; idempotency key on commit.
- Status: Unresolved.

### Manual check-in correction capability

- Question: Can OWNER/staff adjust or correct attendee counts after check-in confirmation?
- Why it matters: MVP CheckinRecord is a confirmed attendance fact; correction semantics need an audit-safe design if required.
- Impacted components/documents: PRD, Database Schema, API Contract, Admin UI.
- Blocking phase: Not blocking base Phase 10 check-in; blocking any correction feature.
- Phase 4 impact: non-blocking.
- Possible choices: append-only correction record, admin-only void/reissue flow, no correction in MVP.
- Status: Unresolved.

### CSV report grouping details

- Question: Which CSV exports are required as separate files for MVP?
- Why it matters: Minimum reporting metrics are confirmed, but export grouping affects API and UI.
- Impacted components/documents: PRD, API Contract, Admin UI.
- Blocking phase: Phase 11 before report export implementation.
- Phase 4 impact: non-blocking.
- Possible choices: one summary CSV, invitations CSV, RSVP CSV, check-in CSV, dietary CSV.
- Status: Unresolved.
