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

## Phase-Blocking Questions

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

### Guest message retry/idempotency

- Question: Should repeated message submissions caused by retry/network ambiguity be deduplicated, idempotent by client key, or allowed as separate messages?
- Why it matters: Message API behavior and frontend retry UX depend on this rule.
- Impacted components/documents: API Contract, messages module, UI/UX Spec.
- Blocking phase: Phase 7 before guest message endpoint ships.
- Phase 4 impact: non-blocking. Phase 4 must not implement message submission or the message confirmation state.
- Possible choices: client idempotency key, simple retry warning, allow duplicates with admin moderation.
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
