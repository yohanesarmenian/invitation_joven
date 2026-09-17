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

## Phase-Blocking Questions

### Wedding date and RSVP deadline conflict

- Question: Figma displays wedding date as `Saturday, 09 January 2027` and RSVP deadline as `25 December 2027`. Which value is correct?
- Why it matters: RSVP deadline after the wedding date is chronologically inconsistent.
- Impacted components/documents: PRD, UI/UX Spec, API validation, RSVP deadline configuration, public invitation copy.
- Blocking phase: Phase 5 RSVP deadline validation and final public content. BLOCKING CONTENT CONFIRMATION REQUIRED before hard-coding production dates or deadline behavior.
- Possible choices: Confirm wedding date, confirm RSVP deadline, or provide revised final copy.
- Status: Unresolved.

### RSVP deadline/update cutoff behavior

- Question: After the RSVP deadline, can guests update RSVP themselves, or only the OWNER?
- Why it matters: Public API validation, UI disabled/error states, and OWNER override behavior depend on this rule.
- Impacted components/documents: PRD, API Contract, UI/UX Spec, RSVP implementation.
- Blocking phase: Phase 5 before final RSVP mutation behavior ships.
- Possible choices: public updates blocked after deadline; grace period; OWNER override only.
- Status: Unresolved.

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
- Possible choices: image, modal, PDF/document, map destination, separate page.
- Status: Unresolved.

### Final wedding copy

- Question: What is the final production copy for names, greetings, event wording, verse, closing, and footer credits?
- Why it matters: Implementation must not fabricate final wedding content.
- Impacted components/documents: UI/UX Spec, public invitation frontend.
- Blocking phase: Phase 4 for final content lock; not a repository foundation blocker.
- Possible choices: Use finalized owner-provided copy or preserve Figma copy after explicit approval.
- Status: Unresolved.

### Final assets and envelope animation cuts

- Question: Which final images and separated envelope/floral assets are approved for production?
- Why it matters: Figma-flattened artwork may not map directly to responsive animation assets.
- Impacted components/documents: UI/UX Spec, public invitation frontend, asset pipeline.
- Blocking phase: Phase 4 for final visual implementation; placeholder implementation may proceed only if explicitly approved.
- Possible choices: export separated assets from Figma, provide production image set, or simplify animation with approved static layers.
- Status: Unresolved.

### Guest message retry/idempotency

- Question: Should repeated message submissions caused by retry/network ambiguity be deduplicated, idempotent by client key, or allowed as separate messages?
- Why it matters: Message API behavior and frontend retry UX depend on this rule.
- Impacted components/documents: API Contract, messages module, UI/UX Spec.
- Blocking phase: Phase 7 before guest message endpoint ships.
- Possible choices: client idempotency key, simple retry warning, allow duplicates with admin moderation.
- Status: Unresolved.

### Invitation link regeneration retry/idempotency

- Question: What deterministic retry/idempotency behavior should the regenerate-link endpoint provide if the admin loses the response?
- Why it matters: Regeneration increments credential version and invalidates old links; ambiguous retries could rotate more than intended.
- Impacted components/documents: API Contract, invitation service, admin UI.
- Blocking phase: Before regenerate endpoint ships, likely Phase 8.
- Possible choices: explicit idempotency key; confirm modal plus response recovery; no automatic retry by client.
- Status: Unresolved.

### Import preview lifetime and idempotent commit semantics

- Question: How long does an import preview remain valid, and how is duplicate commit prevented if an admin retries?
- Why it matters: Preview storage, commit safety, and admin retry behavior depend on this.
- Impacted components/documents: API Contract, imports module, admin import UI.
- Blocking phase: Phase 9 before import implementation.
- Possible choices: short-lived persisted preview; signed temporary preview token; idempotency key on commit.
- Status: Unresolved.

### Manual check-in correction capability

- Question: Can OWNER/staff adjust or correct attendee counts after check-in confirmation?
- Why it matters: MVP CheckinRecord is a confirmed attendance fact; correction semantics need an audit-safe design if required.
- Impacted components/documents: PRD, Database Schema, API Contract, Admin UI.
- Blocking phase: Not blocking base Phase 10 check-in; blocking any correction feature.
- Possible choices: append-only correction record, admin-only void/reissue flow, no correction in MVP.
- Status: Unresolved.

### CSV report grouping details

- Question: Which CSV exports are required as separate files for MVP?
- Why it matters: Minimum reporting metrics are confirmed, but export grouping affects API and UI.
- Impacted components/documents: PRD, API Contract, Admin UI.
- Blocking phase: Phase 11 before report export implementation.
- Possible choices: one summary CSV, invitations CSV, RSVP CSV, check-in CSV, dietary CSV.
- Status: Unresolved.
