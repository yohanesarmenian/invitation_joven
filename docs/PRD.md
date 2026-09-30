# Product Requirements Document

## Product Objective

Create a personal wedding invitation platform that lets invited households open a personalized invitation, RSVP with accurate household and event headcount information, receive a household QR pass as part of an accepted RSVP transaction, and check in at eligible wedding events. The OWNER uses an internal admin interface to manage invitations, invitees, RSVP state, guest messages, imports, check-in, and reporting.

## Users

- Guest: a person who receives a personalized invitation URL as part of a household/group.
- Household/group: the invitation unit represented by one Invitation.
- OWNER: the single effective MVP administrator.
- Venue check-in operator: the OWNER or trusted person using the admin check-in surface.

## Confirmed Requirements

### Public invitation experience

- Guests access a personalized URL using a deterministic server-derived bearer credential.
- Public URLs must not expose sequential database IDs, token hashes, token versions, or admin-only data.
- A valid active invitation URL may reveal only the household invitation information needed for the public experience.
- Archived invitations deny public access with a generic not-available response.
- The guest can open a closed-envelope screen, view the opened cover, then continue to the long-form invitation.
- On valid active public invitation load, the system updates invitation open aggregates: first opened time, last opened time, and open count.
- The long-form invitation should preserve the Figma content journey:
  1. Guest greeting
  2. Bride
  3. Groom
  4. Wedding date
  5. Holy Matrimony
  6. Wedding Reception
  7. Dress Code
  8. RSVP and Dietary Information
  9. Pre-wedding gallery
  10. Bible verse / quote
  11. Guest message
  12. Closing
  13. Credit/footer
- Guests can submit a message/wish associated with their active invitation.
- Guests can return to the invitation after RSVP confirmation or message confirmation.

### Household and invitee behavior

- One Invitation equals one household or invited group.
- An Invitation can contain multiple Invitees.
- Known people invited in advance are Invitees.
- Known spouse is a normal named Invitee.
- Known child is a normal named Invitee.
- Optional unnamed adult companion is represented as `PLUS_ONE`.
- Optional unnamed/additional children are represented as `ADDITIONAL_CHILD`.
- `Invitation.max_additional_children` controls only unnamed/additional children.
- Invitation status is `ACTIVE` or `ARCHIVED`.
- Admin product behavior should archive, not normally hard-delete, invitations.
- Archiving preserves invitees, RSVP, messages, check-in passes, check-in records, and reporting history.

### Event eligibility

- Initial events must support at least Holy Matrimony and Wedding Reception.
- Events are data, not hard-coded checkbox labels.
- `InvitationEvent` is authoritative for which events a household may attend.
- Guests may RSVP only to events for which the invitation is eligible.
- The frontend must hide or disable ineligible event choices.
- The backend must enforce event eligibility regardless of frontend behavior.

### RSVP behavior

- RSVP statuses include `PENDING`, `ACCEPTED`, and `DECLINED`.
- Guests may create and update RSVP up to and including the RSVP cutoff instant. After the cutoff, both create and update are rejected; public invitation retrieval remains available.
- The cutoff is the persisted `Invitation.rsvpDeadlineAt`. The Phase 5 public baseline is `25 December 2026, 23:59:59 Asia/Jakarta` (`2026-12-25T16:59:59Z`).
- Phase 5 defines no public post-deadline override. The OWNER post-deadline override is the separate authenticated admin contract, locked in Phase 8 Slice 8D0: `PUT /api/admin/invitations/{invitationId}/rsvp`. It requires an OWNER session, CSRF, a mandatory reason, and `expectedVersion`, and it records the acting OWNER.
- OWNER may override RSVP when needed. The override may pass the public deadline, but it must satisfy every other RSVP rule: invitation active, event eligibility, attendee composition, capacity and plus-one limits, the canonical accept/decline transitions, the check-in pass lifecycle, and version concurrency.
- Backend validation is authoritative.
- Frontend validation is UX assistance only.
- RSVP uses optimistic versioning. Public reads return `version`; mutations require `expectedVersion`; mismatches return `409 RSVP_VERSION_CONFLICT`.
- `expectedVersion: null` means create-only and fails if an RSVP row already exists. An existing RSVP requires the exact persisted `version`. Empty RSVP rows are not pre-created.
- An `ACCEPTED` RSVP must select at least one eligible attending event.
- `RSVPAttendee` represents the current attendee composition for the RSVP overall.
- `RSVPEventSelection` represents household event intent and expected count for one event.
- Event expected counts may differ from each other and may be lower than total RSVP attendee quantity.
- If an event is not attended, its expected count must be `0`.
- If an event is attended, its expected count must be at least `1` and no more than total RSVP attendee quantity.
- MVP does not require knowing exactly which named person attends which event.
- `Joyfully Accept` and `Regretfully Decline` are mutually exclusive states even if the Figma visual resembles checkboxes.
- RSVP captures household-level dietary notes/requirements: optional, trimmed, maximum 500 characters after trimming, with an empty value stored as `null` and cleared to `null` on decline.

### QR and check-in

- Invitation public credential and check-in credential are separate credentials.
- MVP uses one active check-in QR/pass per accepted invitation/household.
- Accepted RSVP must create or retain required CheckinPass state in the same transaction as RSVP persistence.
- Accepted to Declined revokes the active check-in pass atomically.
- Declined to Accepted issues a new check-in pass atomically.
- Revoked check-in credentials must never become valid again.
- QR payload must not expose internal database UUIDs alone, token hashes, or token versions.
- QR validation is read/validation only and does not create attendance records.
- `CheckinRecord` is created only by explicit confirmation.
- `CheckinRecord.attendee_count` is actual household attendance count for one event.
- Manual and QR confirmation must use the same backend domain service after invitation resolution.
- Duplicate confirmed attendance is prevented by unique `Invitation + Event`.

### Archived invitation behavior

When `Invitation.status = ARCHIVED`:

- Public invitation access is denied.
- Public RSVP read/write is denied.
- Guest message submission is denied.
- QR validation/check-in is denied.
- Existing credentials do not become usable while archived.
- Public APIs return generic `404 INVITATION_NOT_AVAILABLE`.
- OWNER admin APIs may still view historical data.
- Active dashboard metrics exclude archived invitations by default and show archived count separately.
- Reports may include archived invitations through an explicit filter.

### Guest import

- CSV and XLSX are supported for guest import.
- Import flow is Upload -> Parse -> Validate -> Detect possible duplicates -> Preview -> Admin decision -> Commit.
- Preview is not a committed `GuestImportBatch`.
- Import must not immediately insert records after upload.
- Possible duplicates may warn in preview but must not be silently merged.
- True uniqueness violations are errors.
- MVP commit is all-or-nothing for selected validated rows.
- Invitation creation and credential-version/hash initialization occur in the same import commit transaction.
- Successful committed import retains `GuestImportBatch` provenance.

### Reporting

MVP reporting must support:

- Total invitations.
- Active and archived invitations.
- Invitations opened based on aggregate tracking fields.
- RSVP pending, accepted, declined.
- Expected attendee/headcount total from `RSVPAttendee`.
- Expected attendees per event from `RSVPEventSelection`.
- Adults/children where derivable from Invitee category and RSVPAttendee type.
- Dietary notes/requirements.
- Checked-in households.
- Checked-in attendee count from `CheckinRecord`.
- Check-in totals per event.
- Not-yet-arrived accepted invitations.

Initial export format is CSV. XLSX reporting/export is out of scope for MVP. XLSX remains supported for guest import.

## Admin Experience

The admin frontend must provide:

- OWNER login and logout.
- An operational dashboard showing invitation status counts, opened-active count, RSVP status counts, and expected attendance by event. Broader reporting metrics and charts are Phase 11, not Phase 8.
- Invitation list with status, RSVP status, eligibility, opened aggregates, and search/filter controls.
- Invitation detail.
- Create and edit invitation.
- Archive invitation. Archive is terminal in Phase 8: it removes public access while preserving all admin history, and there is no unarchive action.
- Invitee management, including hard deletion when no RSVP references the invitee.
- Event eligibility configuration.
- Additional child allowance and plus-one configuration.
- Copy invitation URL by protected backend re-derivation.
- Regenerate invitation URL by incrementing the public credential version **and** replacing the stored credential hash together. Incrementing the version alone invalidates nothing, because credential lookup resolves by hash and never consults the version. Old links stop working immediately, and regeneration cannot be undone.
- RSVP overview and detail.
- RSVP administrative override, which may operate after the public RSVP deadline and always records the OWNER and a reason.
- Guest message listing and hide/unhide moderation.
- CSV/XLSX guest import with validation preview. Phase 9.
- QR/check-in interface. Phase 10.
- Manual guest lookup fallback. Phase 10.
- CSV reports/export. Phase 11.

MVP has one effective role: OWNER. No permission matrix or role-management UI is required. The
first OWNER is created by an operator-only command, not through a self-registration, signup, or
network bootstrap flow; there is no admin account-creation UI. Multiple simultaneous OWNER
sessions are allowed, and logout ends only the current session.

## Functional Requirements

### Public

- Retrieve active invitation by public credential.
- Update open aggregate tracking during active invitation load.
- Submit/update RSVP for the invitation with `expectedVersion`.
- Retrieve current RSVP/pass state for the invitation, including RSVP `version`.
- Submit guest message for an active invitation.
- Display QR pass only when RSVP and pass state allow it.

### Admin

- Authenticate OWNER.
- Manage sessions.
- Manage invitations and invitees.
- Manage event eligibility.
- Regenerate invitation public URL.
- Override RSVP with the same RSVP/pass lifecycle.
- Validate and commit imports.
- Validate QR/pass for a selected event.
- Confirm check-in with actual attendee count.
- Search manually for guests/households.
- View reports and export CSV.

## Non-Functional Requirements

- Mobile-first public invitation, centered narrow layout on larger screens.
- Public invitation should support approximately 320, 360, 375, 390, 412, 430, and 480 px mobile widths.
- Backend must be secure by default and avoid leaking sensitive credentials.
- Business state transitions must be transactionally safe.
- All invitation-scoped mutations must follow the shared Invitation row lock order.
- Check-in must be robust to simultaneous confirmations.
- Admin UI can be utilitarian and dense.
- Public UI should follow Figma visual direction rather than become a desktop dashboard.
- System should deploy to Docker/VPS/Coolify-style infrastructure.

## Acceptance Criteria

- A household can open a valid active personalized invitation URL without seeing other invitation data.
- Archived invitation credentials return generic `404 INVITATION_NOT_AVAILABLE` publicly.
- An accepted RSVP creates or retains one active household CheckinPass in the same transaction.
- A declined RSVP has no active CheckinPass after the transaction completes.
- Re-accepting after decline creates a new CheckinPass credential.
- Ineligible event RSVP choices are blocked by backend validation.
- Event expected counts obey `attending` and attendee-total validation rules.
- Stale RSVP update attempts return `409 RSVP_VERSION_CONFLICT`.
- Duplicate confirmation for the same invitation/event returns deterministic conflict.
- Import preview separates errors from warnings.
- Potential duplicates are not silently merged.
- Archived invitations remain visible to OWNER and reportable with explicit archived filters.
- CSV export can be generated for MVP reporting data.

## Out of Scope

- Multi-tenant SaaS.
- Role management beyond OWNER.
- Payment, registry, marketing automation, CMS, theme builder, AI.
- Microservices and distributed infrastructure.
- XLSX report export in MVP.
- Raw scan-attempt audit table in MVP.
- Hard deletion through normal admin UI.

## Open Questions

See `OPEN-QUESTIONS.md`. The RSVP deadline value is resolved: `25 December 2026, 23:59:59 Asia/Jakarta` (`2026-12-25T16:59:59Z`), which precedes the displayed wedding date `09 January 2027`. Remaining items are tracked in `OPEN-QUESTIONS.md`.
