# API Contract

## OWNER event management (16 October 2026)

`GET/POST /api/admin/event-management` and `PUT /api/admin/event-management/{eventId}` add an OWNER-only, no-store, versioned event editor. The existing `GET /api/admin/events` catalog contract is preserved. Full editable fields, limits, usage counts, conflict codes and locking policy are documented in [EVENT-MANAGEMENT.md](EVENT-MANAGEMENT.md). No Event delete operation exists. Event config is saved immediately; venue-material publication remains separate.

## OWNER event materials and credential-bound media

The generated OpenAPI contract now includes `AdminEventContentDto`, `EventVenueBodyDto`, versioned save/publish/hide/delete requests, multipart file upload, and public venue projections/media. The seven `/api/admin/event-content/{eventId}` operations are OWNER-only and share the existing session, role, first-password, CSRF and origin enforcement. Read/binary responses are no-store. Full route/payload/error/storage policy is locked in `EVENT-CONTENT-ADMIN.md`; typed clients are generated, not hand-maintained.

New public `.../{publicCredential}/venue-content` and `.../{publicCredential}/venue-assets/{assetId}` operations are read-only and do not record invitation opens. They require a current ACTIVE invitation; only active eligible Event publications/assets are visible. Media must be referenced by the current publication. Unknown, draft-only, hidden, other-event, archived-invitation or rotated-credential media returns the same generic `404 INVITATION_NOT_AVAILABLE`. No raw filenames, binary bytes, hashes, session data, draft, version, or internal publication fields appear in the public JSON. New admin mutations use existing `VALIDATION_ERROR`, `CONFLICT`, `NOT_FOUND`, authentication and CSRF envelopes.

## Public calendar and manual distribution (local lock, 15 October 2026)

Public event projection addition for calendar: `PublicInvitationEventDto.endsAt` is a required nullable ISO instant, sourced only from existing `Event.endsAt`. No persistence migration or implied duration. Calendar export includes only the selected eligible event's public id/name/start/end/venue/address; never personal invitation credentials, QR, or invitation URLs. Invalid/non-increasing end values are omitted by calendar generation.

Manual invitation-message preview uses the existing OWNER public-url read. The OWNER event catalog adds optional nullable `startsAt`, `venueName`, and `address` to its response event subtype, for displaying known event details in the message. Production catalog returns all three keys; older/synthetic payloads may omit them. It does not widen staff access or add event mutations. Copy fetches the current public URL again; if it changed, rebuild the preview and require explicit review/copy. Reading and copying never update invitation open aggregates.

## Reporting contract (Phase 11, local implementation lock, 15 October 2026)

All reporting endpoints are read-only, OWNER-only, use the shared session enforcement, and return `Cache-Control: no-store`. Staff and forced-password-change sessions are denied. No credential, credential hash, pass, QR payload, notes intended for internal administration, or guest message content is projected.

- `GET /api/admin/reports/summary`: optional `archived=exclude|include` (default exclude), optional UUID `eventId`. Returns `generatedAt` (UTC ISO instant), `archived`, and `events[]`: event id/name/isActive, expectedAttendeeCount and expectedHouseholds from accepted attending RSVP selections, actualAttendeeCount and checkedInHouseholds from persisted CheckinRecord, and notArrivedHouseholds from accepted attending selections with no record for that household/event. Includes catalog events even at zero; retains historical inactive events. The counts are independently aggregated to avoid joins multiplying attendance.
- `GET /api/admin/reports/households`: same filters, `kind=RSVP|CHECKIN|NOT_ARRIVED` (default RSVP), shared `page`/`pageSize` defaults and limits. Fixed sort displayName ASC, invitationId ASC, eventId ASC. Returns generatedAt, items and shared page metadata. RSVP is one row per household, including no response as PENDING; eventId restricts to households eligible for that event. CHECKIN is one confirmed household/event record; NOT_ARRIVED is one accepted attending household/event without a record. RSVP rows have no per-event counts. All rows include invitationId, displayName, invitationStatus, rsvpStatus, dietaryNotes, rsvpHouseholdSize (sum of RSVPAttendee.quantity), nullable eventId/eventName/expectedAttendeeCount/actualAttendeeCount/checkedInAt/method/operatorEmail. RSVP size describes intended household composition, not actual attendance. Dietary notes and operator email are OWNER-only personal data.
- `GET /api/admin/reports/export`: same filters, `kind=SUMMARY|RSVP|CHECKIN|NOT_ARRIVED` (default SUMMARY); no pagination. CSV uses the same projections/sort. Export limit is 10,000 detail rows; exceeding it returns `409 REPORT_TOO_LARGE` and requires an event filter. UTF-8 BOM, CRLF, escaped quotes/newlines, neutralized spreadsheet formulas. UTC timestamps have explicit `Utc` headers. Filename is static per report kind. Never accepts user filenames or formula strings as expressions.

Unknown query keys/invalid values return `400 VALIDATION_ERROR`. Each response/export is a repeatable-read database snapshot; separate refresh/export requests can reflect later commits. UI displays freshness and offers explicit refresh. No real-time stream, XLSX export, new tables or migrations.

This document defines intended HTTP behavior. The future NestJS OpenAPI output is the executable contract source, but it must follow these semantics unless higher-level docs change.

## Conventions

Base paths:

- Public: `/api/public`
- Admin: `/api/admin`

Response format:

- Success responses return JSON objects.
- List responses use `{ "items": [], "page": {...} }`. The `page` object is locked for admin lists under "Admin Management Conventions".
- Errors use the shared envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": {}
  }
}
```

Do not expose stack traces or internal exception messages.

Common statuses:

- `200 OK`: successful read/update.
- `201 Created`: resource created.
- `204 No Content`: successful action without body.
- `400 Bad Request`: invalid shape or unsupported payload.
- `401 Unauthorized`: missing/invalid admin session.
- `403 Forbidden`: authenticated but action/session/CSRF not allowed.
- `404 Not Found`: resource not found or intentionally hidden.
- `409 Conflict`: state conflict such as RSVP version conflict or duplicate check-in.
- `422 Unprocessable Entity`: domain validation failed.
- `429 Too Many Requests`: rate limit.

Required error codes:

| Code                              |     Status | Meaning                                                                                                                                                                                                   |
| --------------------------------- | ---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVITATION_NOT_AVAILABLE`        |        404 | Public credential is malformed, unknown, stale, archived, or otherwise unavailable. Do not reveal which.                                                                                                  |
| `RSVP_VERSION_CONFLICT`           |        409 | Submitted `expectedVersion` does not match current persisted RSVP state: a non-null integer differs from the reloaded `RSVP.version`, or `expectedVersion: null` is sent when an RSVP row already exists. |
| `RSVP_DEADLINE_PASSED`            |        422 | Public RSVP create or update was submitted after the invitation RSVP cutoff instant.                                                                                                                      |
| `EVENT_NOT_ALLOWED`               |        422 | Invitation is not eligible for the selected event.                                                                                                                                                        |
| `EVENT_NOT_SELECTED`              |        422 | RSVP does not select attendance for the event; also covers an `ACCEPTED` RSVP that selects zero attending events.                                                                                         |
| `PLUS_ONE_NOT_ALLOWED`            |        422 | RSVP included plus-one without permission.                                                                                                                                                                |
| `ADDITIONAL_CHILD_LIMIT_EXCEEDED` |        422 | Additional child quantity exceeds allowance.                                                                                                                                                              |
| `RSVP_ATTENDEE_INVALID`           |        422 | RSVP attendee rows violate type/quantity/reference rules.                                                                                                                                                 |
| `QR_INVALID`                      | 404 or 422 | Admin scanner received invalid/non-resolvable credential; response must not leak sensitive internals.                                                                                                     |
| `QR_REVOKED`                      |        422 | Admin scanner resolved a revoked/expired pass.                                                                                                                                                            |
| `CHECKIN_ALREADY_CONFIRMED`       |        409 | Invitation already has confirmed attendance for the event.                                                                                                                                                |
| `INVALID_CREDENTIALS`             |        401 | Admin login failed. Covers unknown email, wrong password, and a `DISABLED` account, indistinguishably.                                                                                                    |
| `TOO_MANY_LOGIN_ATTEMPTS`         |        429 | Admin login was rejected by the login throttle. Must not indicate whether the account exists.                                                                                                             |
| `UNAUTHENTICATED`                 |        401 | Admin request without a usable session: missing cookie, malformed session token, unknown session, expired session, idle-expired session, revoked session, or a session whose `AdminUser` is `DISABLED`.   |
| `FORBIDDEN`                       |        403 | Authenticated session without the required role. Phase 10 uses this for CHECKIN_STAFF attempts against OWNER-only endpoints.                                                                              |
| `CSRF_INVALID`                    |        403 | Unsafe authenticated admin request failed CSRF or admin-origin validation. Does not disclose which check failed.                                                                                          |
| `NOT_FOUND`                       |        404 | Authenticated OWNER request referenced a missing admin resource. Admin-domain only.                                                                                                                       |
| `CONFLICT`                        |        409 | Admin-domain state or concurrency conflict where no more-specific existing domain code applies.                                                                                                           |

Admin authentication error codes are locked by Phase 8 Slice 8B0 and must not be merged, split, or renamed during implementation. There is deliberately **no** public `SESSION_EXPIRED` code: an expired, revoked, idle-expired, missing, or disabled-account session all return `401 UNAUTHENTICATED` so the admin client shows one generic state.

Public APIs must not expose credential hashes, credential versions, password/session data, admin-only fields, internal security fields, or data from other invitations.

## Public IDs

Resource IDs in request/response examples are UUID primary keys unless otherwise noted. UUIDs are acceptable for MVP because they are random and non-sequential. Credential strings, token hashes, and credential versions are never public resource identifiers.

For public invitation retrieval, exposing `events[].id` and `invitees[].id` is intentional because later RSVP mutations require `eventId` and `inviteeId`. These IDs belong only to the resolved invitation's public projection. Public responses must not expose `Invitation.id`, `RSVP.id`, `CheckinPass.id`, `GuestMessage.id`, credential versions, credential hashes, audit IDs, admin notes, or other invitations unless another locked contract explicitly requires them.

`GuestMessage.id` is explicitly **not** an exception. Guest message creation is create-only, no public message read operation exists, and the public client has no functional need for the row id, so it stays internal (Phase 7 Slice 7B0).

## Public Endpoints

### Retrieve invitation

`GET /api/public/invitations/{publicCredential}`

Authentication: public credential in path.

Behavior:

- Validate public credential format and resolve credential hash.
- Require Invitation `ACTIVE`.
- Update `first_opened_at`, `last_opened_at`, and `open_count` transactionally for valid active loads.
- Return only public invitation data.
- Events must be reached through `InvitationEvent`; never return all Event rows.
- Event output is ordered by `Event.display_order ASC`; `displayOrder` itself is not exposed.
- Invitee output is ordered by `Invitee.display_order ASC`; do not rely on database natural ordering.
- RSVP state/version represent persisted RSVP state only. Do not synthesize an RSVP row.

Response:

```json
{
  "invitation": {
    "displayName": "John & Jane Smith Family",
    "greetingName": null,
    "rsvpDeadlineAt": null,
    "events": [
      {
        "id": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
        "slug": "holy-matrimony",
        "name": "Holy Matrimony",
        "startsAt": null,
        "endsAt": null,
        "venueName": null,
        "address": null,
        "googleMapsUrl": null
      }
    ],
    "invitees": [
      {
        "id": "1bead0fd-b3f6-49dd-af70-5cf4cc5efb4d",
        "fullName": "John Smith",
        "category": "ADULT"
      }
    ],
    "rules": {
      "allowPlusOne": false,
      "maxAdditionalChildren": 0
    },
    "rsvp": null
  }
}
```

If an RSVP row exists, `rsvp` contains persisted RSVP state only:

```json
{
  "rsvp": {
    "status": "PENDING",
    "version": 1
  }
}
```

If no RSVP row exists, `rsvp` is `null`. The `rsvpDeadlineAt` field belongs to the invitation because the authoritative database field is `Invitation.rsvp_deadline_at`.

Nullable fields:

- `invitation.greetingName`
- `invitation.rsvpDeadlineAt`
- `invitation.events[].startsAt`
- `invitation.events[].endsAt`
- `invitation.events[].venueName`
- `invitation.events[].address`
- `invitation.events[].googleMapsUrl`
- `invitation.rsvp`

Errors:

- `404 INVITATION_NOT_AVAILABLE` for malformed credential, unknown credential, stale credential, archived invitation, or otherwise unavailable invitation.

Unavailable response:

```json
{
  "error": {
    "code": "INVITATION_NOT_AVAILABLE",
    "message": "Resource not found",
    "details": null
  },
  "requestId": "...",
  "timestamp": "..."
}
```

Do not reveal which unavailable case occurred. Never place the public credential in `error.message`, `error.details`, response metadata, or logs.

No separate MVP open-tracking endpoint is required; open aggregates update during valid active invitation retrieval.

### Create or update RSVP

`PUT /api/public/invitations/{publicCredential}/rsvp`

Authentication: public credential.

Request:

```json
{
  "expectedVersion": 1,
  "status": "ACCEPTED",
  "eventSelections": [
    {
      "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
      "attending": true,
      "expectedAttendeeCount": 2
    }
  ],
  "attendees": [
    {
      "type": "NAMED_INVITEE",
      "inviteeId": "1bead0fd-b3f6-49dd-af70-5cf4cc5efb4d",
      "quantity": 1
    },
    {
      "type": "PLUS_ONE",
      "quantity": 1
    },
    {
      "type": "ADDITIONAL_CHILD",
      "quantity": 2
    }
  ],
  "dietaryNotes": "No seafood"
}
```

Request fields:

- `expectedVersion`: required, `integer | null`.
  - `null` means create-only. It succeeds only if no RSVP row exists. If an RSVP already exists by the time the Invitation row lock is held and RSVP state is reloaded inside the transaction, return `409 RSVP_VERSION_CONFLICT`.
  - An integer means update. It must equal the current persisted `RSVP.version`. Mismatch returns `409 RSVP_VERSION_CONFLICT`.
  - Do not send a placeholder `expectedVersion: 1` for a household that has never RSVP'd, and do not eagerly create an empty/`PENDING` RSVP row solely to manufacture a version.
- `status`: `ACCEPTED` or `DECLINED` for public submission.
- `eventSelections[]`: `{ eventId, attending, expectedAttendeeCount }`.
- `attendees[]`: `{ type, inviteeId?, quantity }`.
- `dietaryNotes`: optional household-level text. Trimmed; maximum 500 characters after trimming; empty after trimming normalizes to `null`.
- `guestNote` is not part of the Phase 5 public RSVP mutation contract. It is not accepted, not mutated, and not cleared as a side effect of accept/decline. Guest-message functionality is Phase 7 and uses the separate `GuestMessage` model; `guestNote` is never the guest-message mechanism and Phase 7 never writes, clears, mirrors, or synchronizes it.

Deadline evaluation:

- Public RSVP create and update are both allowed up to and including the cutoff instant.
- After the cutoff, both create and update are rejected with `422 RSVP_DEADLINE_PASSED`.
- The cutoff is evaluated from the persisted `Invitation.rsvp_deadline_at`, which remains the authoritative source field. The stored/API value stays an ISO date-time instant.
- The Phase 5 public baseline cutoff is `2026-12-25T16:59:59Z`, equivalent to `25 December 2026, 23:59:59 Asia/Jakarta (WIB, UTC+7)`.
- `GET /api/public/invitations/{publicCredential}` and `GET /api/public/invitations/{publicCredential}/rsvp` remain available after the cutoff.
- Phase 5 defines no public override after the cutoff. If an OWNER/admin post-deadline override is added later, it must be a separate authenticated admin contract. Do not invent public override behavior.

Response:

```json
{
  "rsvp": {
    "status": "ACCEPTED",
    "version": 2,
    "attendeeQuantityTotal": 4,
    "eventSelections": [
      {
        "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
        "attending": true,
        "expectedAttendeeCount": 2
      }
    ]
  },
  "checkinPass": {
    "status": "ACTIVE",
    "qrPayload": "opaque_backend_credential_payload",
    "issuedAt": "2026-09-17T00:00:00.000Z"
  }
}
```

Validation:

- Invitation credential must resolve to active Invitation.
- `expectedVersion` must be `null` for a first mutation and an exact match of the persisted `RSVP.version` for an existing RSVP.
- Status must be `ACCEPTED` or `DECLINED` for public submission.
- Selected events must be eligible through `InvitationEvent`. Requested events absent from `InvitationEvent` remain invalid.
- If event `attending = false`, `expectedAttendeeCount = 0`.
- If event `attending = true`, `expectedAttendeeCount >= 1`.
- If event `attending = true`, `expectedAttendeeCount <= total RSVPAttendee quantity`.
- If status is `ACCEPTED`, at least one eligible event must be selected with `attending = true`. Accepted with zero attending events returns `422 EVENT_NOT_SELECTED`.
- If status is `DECLINED`, there must be zero attending event selections, zero RSVP attendee rows, `dietaryNotes = null`, and zero active CheckinPass.
- `NAMED_INVITEE` requires `inviteeId`, `quantity = 1`, and Invitee must belong to the Invitation.
- Same named Invitee may appear only once.
- `PLUS_ONE` requires null invitee, `quantity = 1`, and `allowPlusOne = true`.
- At most one `PLUS_ONE` row per RSVP.
- `ADDITIONAL_CHILD` requires null invitee and quantity at least 1.
- Total `ADDITIONAL_CHILD` quantity must not exceed `maxAdditionalChildren`.
- `dietaryNotes` is trimmed; maximum 500 characters after trimming; empty after trimming normalizes to `null`. For `DECLINED`, `dietaryNotes` must become `null`.
- Both create and update are rejected after the cutoff instant with `422 RSVP_DEADLINE_PASSED`.

State transitions:

- `(no RSVP row) -> ACCEPTED` / `(no RSVP row) -> DECLINED`: first public mutation with `expectedVersion: null`; creates the RSVP row at `version = 1`.
- `PENDING -> ACCEPTED`: saves RSVP/selections/attendees and creates exactly one active household CheckinPass atomically.
- `PENDING -> DECLINED`: saves declined state and ensures no active pass.
- `ACCEPTED -> ACCEPTED`: updates current RSVP state and retains the existing active pass; do not create a duplicate active pass.
- `ACCEPTED -> DECLINED`: revokes active pass atomically.
- `DECLINED -> ACCEPTED`: issues a new CheckinPass atomically; do not reactivate the previously revoked credential.
- `DECLINED -> DECLINED`: keeps no active pass.

Public QR consequence of each transition (Phase 6 lock):

| RSVP transition                    | Pass result           | Public `checkinPass` / QR result           |
| ---------------------------------- | --------------------- | ------------------------------------------ |
| no RSVP row                        | none                  | `null` — no QR                             |
| no RSVP row -> `ACCEPTED`          | one new `ACTIVE` pass | `{ status, issuedAt, qrPayload }` — new QR |
| `PENDING`/`ACCEPTED` -> `ACCEPTED` | same pass retained    | same `qrPayload` — QR unchanged            |
| `ACCEPTED` -> `DECLINED`           | active pass revoked   | `null` — QR disappears                     |
| `DECLINED` -> `ACCEPTED`           | new pass issued       | new `qrPayload` — new QR                   |
| `DECLINED` -> `DECLINED`           | none                  | `null` — no QR                             |

A `qrPayload` belonging to a revoked pass must never be redisplayed.

Errors:

- `404 INVITATION_NOT_AVAILABLE`.
- `409 RSVP_VERSION_CONFLICT`.
- `422 EVENT_NOT_ALLOWED`.
- `422 EVENT_NOT_SELECTED`.
- `422 PLUS_ONE_NOT_ALLOWED`.
- `422 ADDITIONAL_CHILD_LIMIT_EXCEEDED`.
- `422 RSVP_ATTENDEE_INVALID`.
- `422 RSVP_DEADLINE_PASSED` after the cutoff instant for both create and update.

Idempotency:

- Retrying after a network failure with an old `expectedVersion` may return `409 RSVP_VERSION_CONFLICT`; the client should re-read state.
- Repeating accepted RSVP at the current version must not create multiple active passes.

Transaction order (Phase 5 lock):

1. Validate public credential shape.
2. Derive/hash the credential outside the transaction.
3. Begin the Prisma interactive transaction.
4. Lock the Invitation using the established parameterized `SELECT ... FOR UPDATE` pattern.
5. Require Invitation status `ACTIVE`.
6. Evaluate the RSVP cutoff against `Invitation.rsvp_deadline_at`.
7. Reload current RSVP and related mutation state under the lock.
8. Check `expectedVersion`.
9. Validate status, event eligibility, attendees, counts, and dietary data.
10. Apply RSVP, selection, and attendee changes.
11. Apply the minimal CheckinPass lifecycle invariant.
12. Increment/set `RSVP.version`.
13. Commit.

Any domain error rolls the transaction back. The raw public credential is never persisted and never retained in logs.

### Retrieve RSVP/pass state

`GET /api/public/invitations/{publicCredential}/rsvp`

Authentication: public credential.

Response includes current RSVP, version, event selections, attendees, and the active pass QR payload when an active pass exists.

Pass representation:

- Accepted RSVP with an `ACTIVE` CheckinPass: `checkinPass` is `{ status: "ACTIVE", issuedAt, qrPayload }`.
- No RSVP row, `PENDING`, `DECLINED`, or no active pass: `checkinPass` is `null`.
- Revoked pass history is never returned publicly. A revoked pass is indistinguishable from no pass in this response.

Errors:

- `404 INVITATION_NOT_AVAILABLE`.

### Public CheckinPass representation (`qrPayload`)

The public `checkinPass` object is exactly:

```json
{
  "status": "ACTIVE",
  "issuedAt": "2026-09-17T00:00:00.000Z",
  "qrPayload": "<opaque check-in credential>"
}
```

Rules (Phase 6 lock):

- `qrPayload` exists only for an `ACTIVE` public CheckinPass representation. It is absent or the whole object is `null` in every other state.
- `qrPayload` is the re-derived opaque check-in credential produced by the server credential derivation for namespace `check-in`, using `CheckinPass.id` as the stable id and `CheckinPass.credentialVersion` as the version. See `TECHNICAL-ARCHITECTURE.md`.
- `qrPayload` is bearer credential material. It is not persisted by the public frontend and must not be logged.
- `qrPayload` is the value encoded directly into the guest QR. It is not a URL, not JSON, not a JWT, not a prefixed string, and not an internal identifier.
- `qrPayload` must never contain or expose `CheckinPass.id`, `tokenHash`, `credentialVersion`, `Invitation.id`, or `RSVP.id`.
- `tokenHash` is never QR content and is never public.
- `credentialVersion` is an internal derivation input and is never public.

The same representation applies to the `PUT` accepted response:

- A mutation that results in `ACCEPTED` with an active pass returns `checkinPass` including `qrPayload`.
- `ACCEPTED -> ACCEPTED` retains the same CheckinPass, so the same derived `qrPayload` is returned.
- `DECLINED -> ACCEPTED` issues a new CheckinPass, so a new `qrPayload` is returned. The earlier revoked credential is never returned again.
- `ACCEPTED -> DECLINED` returns `checkinPass: null`.

### Send guest message

`POST /api/public/invitations/{publicCredential}/messages`

Authentication: public credential.

Phase 7 guest-message contract is locked in Slice 7B0 and is **create-only**. There is no public message read, update, or delete operation, and no public message wall.

Request:

```json
{
  "authorName": "John",
  "message": "Congratulations!"
}
```

`authorName` may be omitted entirely.

Response: `201 Created`.

```json
{
  "message": {
    "createdAt": "2026-09-17T00:00:00.000Z"
  }
}
```

The public response deliberately returns **only** `createdAt`.

- `GuestMessage.id` is **internal** and is never returned publicly. The public client has no functional need for it, and an internal UUID is not exposed merely because it exists.
- The response never contains `invitationId`, `isHidden`, `Invitation.id`, `publicTokenHash`, `credentialVersion`, or admin metadata.
- The response does not echo `message` or `authorName`.

Content contract:

- `message` is required, plain text only, trimmed of leading and trailing whitespace before persistence, and rejected if empty after trimming.
- `message` maximum length after trimming is **1000 Unicode characters**. Internal line breaks are preserved. Unicode and emoji are allowed.
- HTML is not interpreted, Markdown is not interpreted, and links are not auto-converted to HTML. The stored value is the trimmed plain-text message.
- `authorName` is optional guest-entered free text. It is never derived from `Invitee`, `Invitation.greetingName`, or `RSVP`. It is trimmed; empty after trimming becomes `null`; maximum length after trimming is **100 Unicode characters**. Anonymous submission (`authorName: null`) is valid.
- The request never accepts `invitationId`, `inviteeId`, `rsvpId`, `isHidden`, `createdAt`, or `id`. The owning Invitation comes exclusively from credential resolution.

Window:

- Submission is independent of RSVP existence, RSVP status, and `rsvpDeadlineAt`. A message may be submitted while `Invitation.status` is `ACTIVE` even when no RSVP exists, the RSVP is `ACCEPTED` or `DECLINED`, or the RSVP cutoff has passed.
- Submission is denied when the Invitation is `ARCHIVED` or otherwise unavailable through the public credential boundary, using the generic `404 INVITATION_NOT_AVAILABLE` response.
- No message-specific deadline error exists. `RSVP_DEADLINE_PASSED` is never reused for guest messages.

Errors:

- `400 VALIDATION_ERROR` for malformed body, wrong field type, missing `message`, empty-after-trim `message`, `message` longer than 1000 characters, or `authorName` longer than 100 characters. Field-level structure follows the existing shared validation envelope.
- `404 INVITATION_NOT_AVAILABLE` for unknown credentials, unavailable invitations, and archived invitations, preserving the generic non-enumerating behavior. The response does not reveal whether the credential never existed or the invitation was archived.
- Unexpected failures use the existing generic server-error behavior and add no message-specific internal detail. Error responses never echo message content, `authorName`, the public credential, or database IDs.

Retry and duplicate semantics:

- Messages are create-only append operations. Every explicit successful submission creates a new `GuestMessage` row, and multiple messages from the same invitation are allowed.
- There is no idempotency key, no unique message-per-invitation rule, no optimistic version, no update-on-duplicate behavior, and no automatic retry.
- The frontend disables submit while a submission is pending and must not automatically retry the `POST` when the network outcome is uncertain.
- A guest may explicitly submit again. An explicit second submission is a new message and may create a duplicate if the earlier uncertain request actually committed. This is an accepted MVP behavior.
- See `OPEN-QUESTIONS.md` for the locked Phase 7 decision record.

Logging:

- `GuestMessage` content is user-authored personal content. The implementation must not deliberately log the raw message body, `authorName`, or the public credential, and must not add request-body debug logging.

## Admin Authentication Endpoints

**Locked by Phase 8 Slice 8B0 and extended by Phase 10B.** First-OWNER creation is an operator CLI and is deliberately not an HTTP route; see `TECHNICAL-ARCHITECTURE.md` (D2). Phase 10B keeps the same login/session/cookie/CSRF mechanism and allows the authenticated user role to be either `OWNER` or `CHECKIN_STAFF`.

### Login

`POST /api/admin/auth/login`

Authentication: none. No existing session is required and no CSRF token is required. The expected-origin rule **is** enforced (see "Admin CSRF and origin doctrine").

Request:

```json
{
  "email": "owner@example.com",
  "password": "a correct horse battery staple"
}
```

Request rules:

- `email`: required string; trimmed; lowercased; syntactically valid; maximum 254 characters. The normalized form is what is persisted at bootstrap and what login looks up.
- `password`: required string; **not** trimmed; 15 to 128 Unicode code points. Whitespace is valid content and Unicode is allowed.
- Unknown extra top-level fields follow the existing strict DTO validation doctrine and are rejected with `400 VALIDATION_ERROR`.

Response `200 OK`:

```json
{
  "user": {
    "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
    "email": "owner@example.com",
    "role": "OWNER"
  },
  "session": {
    "expiresAt": "2026-09-30T21:14:07.000Z"
  },
  "csrfToken": "unpadded-base64url-session-bound-csrf-token"
}
```

Side effects:

- Sets the environment-appropriate `HttpOnly` admin session cookie (production `__Host-admin_session`; development/test `admin_session`).
- Creates a new `AdminSession` row storing only `SHA-256(sessionToken)` and `SHA-256(csrfToken)`.
- Updates `AdminUser.lastLoginAt`.

The raw session token is **never** in the JSON body; it is delivered only through the cookie.

Errors:

- `400 VALIDATION_ERROR` for a malformed request body.
- `401 INVALID_CREDENTIALS` for unknown email, wrong password, and a `DISABLED` account, indistinguishably.
- `403 CSRF_INVALID` for a failed admin-origin check.
- `429 TOO_MANY_LOGIN_ATTEMPTS` when the login throttle rejects the request.

### Current session

`GET /api/admin/auth/me`

Authentication: admin session cookie. No CSRF token required.

Behavior: resolves the session, requires `AdminUser.status === ACTIVE`, re-derives the session-bound CSRF token from the raw cookie token so the admin client can recover it after a refresh or a new server render, and returns the same shape as a successful login.

Response `200 OK`:

```json
{
  "user": {
    "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
    "email": "owner@example.com",
    "role": "OWNER"
  },
  "session": {
    "expiresAt": "2026-09-30T21:14:07.000Z"
  },
  "csrfToken": "unpadded-base64url-session-bound-csrf-token"
}
```

Never returned: session id, session token, `sessionTokenHash`, `csrfTokenHash`, `passwordHash`, `ipAddress`, `userAgent`. `CHECKIN_STAFF` receives the same response shape with `"role": "CHECKIN_STAFF"` and is redirected by the frontend to `/checkin`.

Errors: `401 UNAUTHENTICATED` for any unusable session.

### Logout

`POST /api/admin/auth/logout`

Authentication: admin session cookie **plus** CSRF token. Origin validation also applies.

Response: `204 No Content`.

Side effects: sets `revokedAt` on the **current** `AdminSession` only, and clears the current session cookie with matching name, path, and environment attributes. Other OWNER sessions are unaffected. See `TECHNICAL-ARCHITECTURE.md` (D13).

Errors: `401 UNAUTHENTICATED`, `403 CSRF_INVALID`.

### Change own password

`POST /api/admin/auth/change-password`

Authentication: admin session cookie plus CSRF token. Authorized roles: `OWNER`, `CHECKIN_STAFF`.

Request:

```json
{
  "currentPassword": "current password",
  "newPassword": "new correct horse battery staple"
}
```

Rules:

- `newPassword` follows the same 15 to 128 Unicode-code-point password policy as login/bootstrap.
- The server verifies the current password, stores only the new Argon2id hash, and never logs either password.
- On success, all other sessions for the same `AdminUser` are revoked. The current session may remain valid only if its CSRF binding and account status remain valid; a simpler implementation may revoke all sessions and require re-login.
- If the user has `mustChangePassword = true`, a successful change clears it.

Response: `204 No Content`.

Errors: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `401 INVALID_CREDENTIALS` for wrong current password, `403 CSRF_INVALID`.

## Admin CSRF and origin doctrine

**Locked by Phase 8 Slice 8B0.**

- Every authenticated unsafe admin operation (`POST`, `PUT`, `PATCH`, `DELETE`) requires the `X-CSRF-Token` header. The only exception is `POST /api/admin/auth/login`, which has no authenticated session yet.
- `GET`, `HEAD`, and `OPTIONS` must not mutate state and do not require a CSRF token.
- The CSRF token is deterministic per `AdminSession`: HMAC-SHA256 keyed by the raw session token bytes with context `admin-csrf-v1`, encoded as unpadded Base64URL. Only `SHA-256(csrfToken)` is persisted, in `AdminSession.csrfTokenHash`. Comparison is timing-safe.
- A successful login and `GET /api/admin/auth/me` both return the raw CSRF token, which is how the admin client recovers it after a refresh without rotating the session.
- One deterministic token is bound to each session; a new login produces a different token.
- No double-submit cookie, no CSRF token in a URL, and no CSRF token in `localStorage`/`sessionStorage`.

Origin rule, applied to every browser unsafe admin request including login:

- `Origin` present: require an exact match with the configured `ADMIN_ORIGIN` (scheme + host + optional port; no wildcard, no trailing path).
- `Origin` absent, `Referer` present: require its origin to exactly match `ADMIN_ORIGIN`.
- Neither yields a valid expected origin: reject with `403 CSRF_INVALID`.
- Substring and suffix matching are not permitted.

Broad CORS is not enabled to satisfy this, and `SameSite=Strict` is treated as defense in depth rather than as a CSRF solution.

## Admin Management Conventions

**Locked by Phase 8 Slice 8D0 and extended by Phase 10B.** These apply to every admin-management endpoint. The auth contract in the previous section is unchanged except for the explicit `CHECKIN_STAFF` role.

### Shared enforcement

- Every `/api/admin/**` route except `POST /api/admin/auth/login` requires a valid session.
- Authorization is deny-by-default. Each route declares allowed roles explicitly. Existing Phase 8 and Phase 9 administrative routes remain `OWNER`-only unless this document says otherwise.
- Safe methods (`GET`, `HEAD`, `OPTIONS`) must not mutate state and require no CSRF token.
- Unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) additionally require exact `ADMIN_ORIGIN` validation and a valid `X-CSRF-Token`.
- Enforcement is a **shared** backend surface, not a per-controller manual call. A route must not be able to opt out by omission. Exact guard/decorator names remain an implementation detail.
- Login is the single intentional exception, because no authenticated session exists yet.

### Role authorization matrix

| Area / path pattern                                                                           | OWNER | CHECKIN_STAFF | Unauthenticated |
| --------------------------------------------------------------------------------------------- | ----- | ------------- | --------------- |
| `POST /api/admin/auth/login`                                                                  | allow | allow         | allow           |
| `GET /api/admin/auth/me`                                                                      | allow | allow         | deny            |
| `POST /api/admin/auth/logout`                                                                 | allow | allow         | deny            |
| `POST /api/admin/auth/change-password`                                                        | allow | allow         | deny            |
| Dashboard `/api/admin/dashboard`                                                              | allow | deny          | deny            |
| Invitations `/api/admin/invitations/**` except check-in routes                                | allow | deny          | deny            |
| Invitees `/api/admin/invitees/**`                                                             | allow | deny          | deny            |
| Events general admin endpoints                                                                | allow | deny          | deny            |
| RSVPs `/api/admin/rsvps/**` and OWNER override                                                | allow | deny          | deny            |
| Guest messages `/api/admin/messages/**` and scoped message lists                              | allow | deny          | deny            |
| Imports `/api/admin/imports/**`                                                               | allow | deny          | deny            |
| Staff management `/api/admin/staff/**`                                                        | allow | deny          | deny            |
| Check-in event picker `GET /api/admin/checkin/events`                                         | allow | allow         | deny            |
| QR validate/confirm `/api/admin/checkin/validate`, `/confirm`                                 | allow | allow         | deny            |
| Manual search/confirm/status `/api/admin/checkin/search`, `/manual-confirm`, `/manual-status` | allow | allow         | deny            |
| Reports `/api/admin/reports/**`                                                               | allow | deny          | deny            |

`CHECKIN_STAFF` denial is a backend authorization decision, not a hidden-link convention. Direct requests to OWNER-only APIs return `403 FORBIDDEN` after authentication, with no privileged data in the response.

### Shared pagination

Admin list endpoints accept:

- `page`: integer, 1-based, default `1`, minimum `1`.
- `pageSize`: integer, default `25`, minimum `1`, maximum `100`.

Invalid values return `400 VALIDATION_ERROR`.

Response envelope, shared by every admin list:

```json
{
  "items": [],
  "page": {
    "number": 1,
    "pageSize": 25,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

- `totalItems` counts rows **after filters and before pagination**.
- `totalPages = ceil(totalItems / pageSize)`.
- Zero items means `totalPages` is `0`.
- An otherwise valid page beyond the final page returns an empty `items` array, the requested `number`, and correct totals. It is **not** a `404`.
- Cursor pagination is not used in Phase 8.

### Shared sorting

Admin list endpoints accept `sortBy` and `sortOrder` (`asc` | `desc`). An unsupported field or order returns `400 VALIDATION_ERROR`. Client-supplied sort fields are whitelisted per endpoint and never interpolated into SQL.

Every ordering appends `id ASC` as a deterministic final tie-breaker, so page boundaries stay stable.

Never sortable: public credential, `publicTokenHash`, `publicTokenVersion`, `Invitation.notes`, `GuestMessage.message`, and auth/session fields.

### Shared search

Where an endpoint accepts `search`:

- The value is trimmed of outer whitespace; empty after trimming is treated as omitted.
- Maximum 100 Unicode code points.
- Case-insensitive partial match.
- No full-text, trigram, or new database extension/index is introduced in Phase 8.

Searchable fields are listed per endpoint. Never searchable: the public credential, `publicTokenHash`, `publicTokenVersion`, internal UUIDs, `CheckinPass` credential or hash, and auth/session fields.

### Error doctrine

- `400 VALIDATION_ERROR` for malformed query, body, or input.
- `404 NOT_FOUND` for an authenticated OWNER request referencing a missing admin resource.
- `409 CONFLICT` for state or concurrency conflicts where no more-specific existing domain code applies.
- The public `404 INVITATION_NOT_AVAILABLE` is **not** reused for admin resource lookups. It exists to keep public credential resolution indistinguishable and carries public non-enumeration semantics that admin-domain lookups do not have.
- Existing RSVP domain codes remain authoritative where they apply: `RSVP_VERSION_CONFLICT`, `RSVP_DEADLINE_PASSED`, `EVENT_NOT_SELECTED`, `EVENT_NOT_ALLOWED`, `PLUS_ONE_NOT_ALLOWED`, `ADDITIONAL_CHILD_LIMIT_EXCEEDED`, `RSVP_ATTENDEE_INVALID`.
- Admin responses may carry a safe, actionable message. They never expose stack traces, SQL, internal exception text, credentials, or hashes.

### Response shape doctrine

Admin responses use **explicit DTOs**. Prisma models are never returned directly, and an admin route never becomes a raw table dump because the caller is authenticated. The prohibited fields are enumerated under "Response Privacy" below.

## Admin Dashboard

`GET /api/admin/dashboard`

Authentication: OWNER.

**Locked by Phase 8 Slice 8D0.** The earlier dashboard payload in this document was illustrative and has been replaced. Phase 8 ships only metrics whose source data has a writer in Phase 8.

Response:

```json
{
  "invitations": {
    "active": 118,
    "archived": 2,
    "openedActive": 90
  },
  "rsvp": {
    "pending": 40,
    "accepted": 70,
    "declined": 10
  },
  "expectedByEvent": [
    {
      "event": {
        "id": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
        "slug": "holy-matrimony",
        "name": "Holy Matrimony"
      },
      "expectedAttendeeCount": 120
    }
  ]
}
```

Definitions:

- `invitations.active`: `Invitation.status = ACTIVE`.
- `invitations.archived`: `Invitation.status = ARCHIVED`.
- `invitations.openedActive`: `ACTIVE` invitation with `openCount > 0`.
- `rsvp.accepted` / `rsvp.declined`: `RSVP.status` counts belonging to `ACTIVE` invitations.
- `rsvp.pending`: `ACTIVE` invitations with **no RSVP row** or with an RSVP row whose status is `PENDING`. RSVP rows are created lazily, so an absent row is the normal pending state.
- `expectedByEvent[].expectedAttendeeCount`: for `ACTIVE` invitations with an `ACCEPTED` RSVP, the sum of `RSVPEventSelection.expectedAttendeeCount` over attending selections, grouped by `Event`.

Archived invitations are excluded from every `rsvp` and `expectedByEvent` metric and are reported only through `invitations.archived`.

The read should use one consistent database read/transaction where practical so the counts describe one instant.

**Not in the Phase 8 dashboard:** the `checkin` block, checked-in households, checked-in attendee counts, not-yet-arrived counts, adult/child reporting totals, `headcount.expectedTotal` (cross-event sums double-count households attending more than one event), and reporting charts. Check-in metrics need Phase 10 `CheckinRecord` data; broader reporting belongs to Phase 11.

## Admin Invitation Endpoints

All endpoints in this section follow "Admin Management Conventions". Mutations require OWNER plus CSRF plus exact origin. Mutations are rejected with `409 CONFLICT` when the Invitation is `ARCHIVED`; archive is terminal.

### List invitations

`GET /api/admin/invitations?status=ACTIVE&rsvpStatus=ACCEPTED&search=smith&sortBy=createdAt&sortOrder=desc&page=1&pageSize=25`

Authentication: OWNER.

Query:

- `status`: `ACTIVE` | `ARCHIVED`. Omitted means all statuses.
- `rsvpStatus`: `PENDING` | `ACCEPTED` | `DECLINED`. `PENDING` means an invitation with **no RSVP row** or with `RSVP.status = PENDING`.
- `search`: matches `Invitation.displayName`, `Invitation.greetingName`, or a related `Invitee.fullName`.
- `sortBy`: `createdAt` | `updatedAt` | `displayName` | `status` | `lastOpenedAt`. Default `createdAt`.
- `sortOrder`: `asc` | `desc`. Default `desc`.
- `page`, `pageSize`: shared pagination.

Item:

```json
{
  "items": [
    {
      "id": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
      "displayName": "John & Jane Smith Family",
      "greetingName": "John & Jane",
      "status": "ACTIVE",
      "rsvpStatus": "ACCEPTED",
      "inviteeCount": 3,
      "openCount": 4,
      "lastOpenedAt": "2026-09-29T10:15:00.000Z",
      "rsvpDeadlineAt": "2026-12-25T16:59:59.000Z",
      "createdAt": "2026-09-17T00:00:00.000Z",
      "updatedAt": "2026-09-29T10:15:00.000Z",
      "archivedAt": null
    }
  ],
  "page": { "number": 1, "pageSize": 25, "totalItems": 1, "totalPages": 1 }
}
```

`rsvpStatus` is the persisted RSVP status, or `PENDING` when no RSVP row exists.

Not in the list item: the public credential, public URL, `publicTokenHash`, `publicTokenVersion`, `notes`, invitee arrays, messages, `qrPayload`, pass credentials, and a guest-message count. The list is a summary; use the detail endpoint for relations.

### Create invitation

`POST /api/admin/invitations`

Authentication: OWNER plus CSRF plus exact origin.

Request:

```json
{
  "displayName": "John & Jane Smith Family",
  "greetingName": "John & Jane",
  "allowPlusOne": false,
  "maxAdditionalChildren": 2,
  "rsvpDeadlineAt": null,
  "notes": null,
  "eventIds": ["7d98761a-b7fc-4a2e-8df4-69b6f22d85b4"],
  "invitees": [
    { "fullName": "John Smith", "category": "ADULT" },
    { "fullName": "Alice Smith", "category": "CHILD", "label": null }
  ]
}
```

Invitee items use the existing `category` values `ADULT` and `CHILD`. There are no contact, phone, email, or CRM fields, and none may be invented.

Behavior — **one transaction**:

1. Begin transaction.
2. Allocate the new `Invitation.id` (UUID) in application/domain code, before any credential work.
3. Derive the public credential through the existing deterministic invitation derivation, using namespace `invitation`, stable id = the newly allocated `Invitation.id`, and version `1`. Hash the derived credential to produce `public_token_hash`. Plaintext is never persisted.
4. Insert the Invitation with `status = ACTIVE`, `public_token_version = 1`, and the `public_token_hash` derived in step 3, together with every canonical Invitation field.
5. Create one `InvitationEvent` row per `eventId`.
6. Create the invitees, assigning `displayOrder` from request array position (`0, 1, 2, ...`).
7. Commit.

Credential coherence invariant: an Invitation must never become a committed row with a missing, placeholder, or mismatched `public_token_version` / `public_token_hash`. **Version and hash begin coherently at version 1**, in the same insert. A temporary or fake hash, a blank credential hash, a two-transaction setup, or a post-insert credential backfill on a `NOT NULL` column are all forbidden. The concrete Prisma mechanism may differ (for example a client-generated UUID supplied to `create`), but the invariant does not.

Rules:

- `eventIds` must contain no duplicates, and every referenced `Event` must exist and be selectable (see "Admin Event Endpoints").
- Display/greeting/name text uses the existing project text normalization doctrine.
- Duplicate invitee names are allowed. There is no uniqueness rule on `Invitee.fullName`.
- The Invitation, its `InvitationEvent` rows, its invitees, and the initial credential version/hash state all belong to **one** transaction. Failure of any write rolls back the whole create; there is no partially-created household.
- **No RSVP row is created.** Phase 5 locks lazy RSVP creation: `expectedVersion: null` create-only semantics depend on the absence of an RSVP row, so no empty/`PENDING` RSVP row may be pre-created.

Response: `201 Created` with the created invitation detail plus a public URL object (`publicUrl` and `publicTokenVersion`).

The configured public invitation origin is validated before the create transaction starts. An invalid `PUBLIC_INVITATION_BASE_URL` must fail without creating an invitation graph. Later transport/read failures can still have an uncertain outcome; this does not make create idempotent.

Create retry doctrine — **create is not idempotent** and no idempotency key is introduced:

- admin-web prevents duplicate pending submissions, never auto-retries after an uncertain network result, and never claims success without a confirmed response.
- If the outcome is uncertain, admin-web locks the draft and offers a fresh invitation-list read in another tab. A non-secret `invitation-create-pending=pending` session marker preserves this lock across reloads. The marker contains no guest information, credentials, or public URL. After checking the list, the OWNER may explicitly start a separate invitation; the original draft is never replayed automatically. This per-tab guard is not server-side idempotency or cross-tab deduplication.
- No content-based deduplication is attempted.

### Get invitation detail

`GET /api/admin/invitations/{invitationId}`

Authentication: OWNER.

Response fields: `id`, `displayName`, `greetingName`, `status`, `allowPlusOne`, `maxAdditionalChildren`, `rsvpDeadlineAt`, `notes`, `publicTokenVersion`, `openCount`, `firstOpenedAt`, `lastOpenedAt`, `createdAt`, `updatedAt`, `archivedAt`.

Embedded relations:

- `invitees` — full invitee DTOs (`id`, `fullName`, `category`, `label`, `displayOrder`, `updatedAt`).
- `eligibility` — current `InvitationEvent` rows with safe `Event` metadata (`id`, `slug`, `name`, `isActive`, `displayOrder`).
- RSVP summary/detail sufficient for the invitation detail page, including `status` and `version`.
- Message summary only: `total` and `hidden` counts.
- Check-in pass **metadata history** when an RSVP exists: `status`, `issuedAt`, `revokedAt`, `revocationReason`, `expiresAt`. `credentialVersion` may be included as operational metadata.

Not embedded: `publicTokenHash`, the raw public credential, the public URL, `qrPayload`, `CheckinPass.tokenHash`, auth/session fields, and `CheckinRecord` history.

The public URL is deliberately fetched only from `GET /api/admin/invitations/{invitationId}/public-url`, so raw credential material stays out of normal detail responses and out of normal detail-page logging. `CheckinRecord` admin history is Phase 10 and is not part of the Phase 8 detail response.

### Update invitation

`PATCH /api/admin/invitations/{invitationId}`

Authentication: OWNER plus CSRF plus exact origin.

Writable fields only: `displayName`, `greetingName`, `allowPlusOne`, `maxAdditionalChildren`, `rsvpDeadlineAt`, `notes`.

Not writable here: `id`, `status`, `archivedAt`, `publicTokenVersion`, `publicTokenHash`, the open aggregates, invitees, eligibility, and RSVP. Archive has its own endpoint; token rotation has its own endpoint.

The Invitation must be `ACTIVE`. An archived invitation returns `409 CONFLICT`.

Concurrency:

- The request **must** include `expectedUpdatedAt`, the `updatedAt` value last returned by the admin API.
- Transaction: lock the Invitation row, require the resource exists, require `ACTIVE`, compare the persisted `updatedAt` with `expectedUpdatedAt` using the application's canonical timestamp representation, and on mismatch return `409 CONFLICT` with **no writes**. Only then validate and apply the mutation and return the updated detail.
- There is no silent last-writer-wins behavior.

**No `Invitation.version` column is added.** `expectedUpdatedAt` is the Phase 8 invitation concurrency mechanism; the RSVP `version` contract is unchanged and separate.

A retry after a lost response may return `409 CONFLICT` because its `expectedUpdatedAt` is now stale. The client refetches rather than auto-repeating.

### Archive invitation

`POST /api/admin/invitations/{invitationId}/archive`

Authentication: OWNER plus CSRF plus exact origin.

Request body: empty. There is no `reason` property — the earlier illustrative `{ "reason": ... }` payload has been removed because there is no `archiveReason` column, and the contract does not accept data that cannot be persisted truthfully.

First successful archive: lock the Invitation row, set `status = ARCHIVED` and `archivedAt`, commit. Every child and history row is preserved. The public credential is **not** rotated. RSVP, pass, and message history are **not** mutated.

Response: `200` with `{ "invitation": { "id": "...", "status": "ARCHIVED", "archivedAt": "..." } }`.

Archive is **idempotent**. If the invitation is already `ARCHIVED`: return `200`, return the existing `archivedAt` unchanged, and perform no new domain writes.

**No unarchive operation exists in Phase 8.**

Archiving continues to disable the existing public flows exactly as the public-domain doctrine already requires.

### Copy invitation URL

`GET /api/admin/invitations/{invitationId}/public-url`

Authentication: OWNER.

Only an `ACTIVE` invitation may return a usable public URL. An `ARCHIVED` invitation returns `409 CONFLICT`, because its link is inert.

Response:

```json
{
  "publicUrl": "https://invitation.example.com/i/<derived-credential>",
  "publicTokenVersion": 1
}
```

Behavior:

- Re-derive the current credential from `CREDENTIAL_SECRET`, `Invitation.id`, and the current `public_token_version`, using the existing derivation contract.
- Verify the derived credential against the persisted `public_token_hash`. A mismatch is a server-side integrity failure and is **not** silently repaired.
- **Do not** increment `openCount`, and do not modify `firstOpenedAt` or `lastOpenedAt`. This is an admin read, not a guest open. It must not reuse the public retrieval path, which mutates open aggregates.
- Never persist the plaintext credential.
- Never deliberately log `publicUrl` or the raw credential.

The URL origin comes from the non-secret `PUBLIC_INVITATION_BASE_URL` configuration value (see Slice 8D0 deployment requirements).

### Regenerate public URL

`POST /api/admin/invitations/{invitationId}/regenerate-token`

Authentication: OWNER plus CSRF plus exact origin.

The Invitation must be `ACTIVE`. An archived invitation returns `409 CONFLICT`.

Request:

```json
{ "expectedTokenVersion": 1 }
```

`expectedTokenVersion` is the `publicTokenVersion` last read from the invitation detail or from `GET public-url`. It is mandatory.

Transaction:

1. Lock the Invitation row.
2. Require the Invitation exists.
3. Require `ACTIVE`.
4. Compare the persisted `publicTokenVersion` with `expectedTokenVersion`. On mismatch: `409 CONFLICT` and **no rotation**.
5. `nextVersion = current + 1`.
6. Derive the next credential using the existing deterministic invitation credential doctrine.
7. Hash the next credential.
8. Update `publicTokenVersion = nextVersion` and `publicTokenHash` together.
9. Commit.
10. Return `{ "publicUrl": "...", "publicTokenVersion": nextVersion }`.

Old credential becomes invalid immediately after commit.

Response:

```json
{
  "publicUrl": "https://invitation.example.com/i/<next-derived-credential>",
  "publicTokenVersion": 2
}
```

Retry and lost-response doctrine — regeneration is **not** automatically retryable:

- admin-web never auto-retries regeneration, keeps exactly one request pending, and treats an uncertain outcome as **unknown**, not as a failed commit.
- Recovery is a read: call `GET /api/admin/invitations/{invitationId}/public-url`. If the mutation committed, this re-derives and returns the currently valid link. Because derivation is deterministic, the current link is always recoverable without an idempotency key.
- If the OWNER explicitly retries the regeneration with the **old** `expectedTokenVersion`, the API returns `409 CONFLICT` and **must not rotate again**.

Concurrent regeneration:

- Two requests carrying the same `expectedTokenVersion` serialize on the Invitation row lock. The first succeeds and increments the version. The second observes the changed version and returns `409 CONFLICT` with no rotation.
- Therefore exactly **one** version increment occurs for concurrent requests originating from the same displayed state. There is no "both succeed, last writer wins" behavior.

No `Idempotency-Key` header, no idempotency table, and no new schema column are introduced.

## Admin Invitee Endpoints

Authentication: OWNER for reads, OWNER plus CSRF plus exact origin for mutations. The owning Invitation must be `ACTIVE`; an archived invitation returns `409 CONFLICT`.

### Create invitee

`POST /api/admin/invitations/{invitationId}/invitees`

Request:

```json
{ "fullName": "Alice Smith", "category": "CHILD", "label": null }
```

`fullName` is trimmed and must be non-empty. `label` is optional, trimmed, and blank normalizes to `null`. Only the existing `ADULT` and `CHILD` categories are accepted.

Transaction: lock the Invitation row, compute the current maximum `displayOrder`, assign the next value, create the `Invitee`, commit. Concurrent creates serialize through the Invitation row lock.

Duplicate names are allowed. Create is **not idempotent**, and admin-web must not auto-retry it after an uncertain result.

Response: `201 Created` with the invitee DTO (`id`, `invitationId`, `fullName`, `displayOrder`, `category`, `label`, `createdAt`, `updatedAt`).

### Update invitee

`PATCH /api/admin/invitees/{inviteeId}`

Writable: `fullName`, `category`, `label`.

Immutable: `id`, `invitationId`, `displayOrder`.

The request must include `expectedUpdatedAt`, with the same compare-and-conflict behavior as invitation update. A stale value returns `409 CONFLICT`.

A missing invitee returns `404 NOT_FOUND`.

**Phase 8 does not implement invitee reordering.** `displayOrder` stays stable once assigned.

### Delete invitee

`DELETE /api/admin/invitees/{inviteeId}`

**Hard delete only.** No soft-delete or inactive state is added to the schema.

Safety rule: if **any** `RSVPAttendee` row references this invitee, return `409 CONFLICT` and delete nothing. No implicit RSVP or attendee reconciliation is performed.

If unreferenced, delete the invitee and return `204 No Content`.

If the invitee is already absent, also return `204 No Content`, so a lost successful `DELETE` response can be retried safely.

There is no inactive or archived invitee state in Phase 8.

### Post-RSVP invitee edit semantics

Editing `Invitee.fullName`, `Invitee.category`, or `Invitee.label` does **not** rewrite existing `RSVPAttendee` rows.

An existing RSVP attendee composition is treated as a **submitted snapshot**. Name and category edits affect the invitation's invitee list, not historical RSVP composition. `RSVPAttendee.displayName` exists precisely to decouple the two.

If the RSVP itself needs correction, the OWNER uses the authenticated RSVP override flow. Name or category edits are never silently cascaded into a submitted RSVP.

## Admin Event Endpoints

### List events

`GET /api/admin/events`

Authentication: OWNER.

Phase 8 manages `InvitationEvent` **eligibility only**. There is no `Event` create, update, or delete endpoint, and the event catalog is not silently extended.

Response: the existing `Event` fields needed for selection and display, using the exact schema field names — `id`, `slug`, `name`, `isActive`, `displayOrder`.

Ordering: `displayOrder ASC`, `id ASC`. Not paginated; the event catalog is a small fixed set.

Inactive events **are** returned, so existing eligibility and historical RSVP context remain representable. The admin UI may show them as inactive. An inactive event cannot be newly added to eligibility, and historical eligibility is not silently deleted merely because an `Event` becomes inactive.

### Replace invitation eligibility

`PUT /api/admin/invitations/{invitationId}/events`

Authentication: OWNER plus CSRF plus exact origin.

Request:

```json
{ "eventIds": ["7d98761a-b7fc-4a2e-8df4-69b6f22d85b4"] }
```

This is one **declarative set-to-value** operation. The body describes the desired final eligibility set; additions and removals are derived from it. Repeating the same body is naturally retry-safe.

Rules:

- The Invitation must be `ACTIVE`. An archived invitation returns `409 CONFLICT`.
- `eventIds` contains no duplicates.
- Every `Event` id must exist and be selectable. Unknown ids return `400 VALIDATION_ERROR`; an inactive event returns `400 VALIDATION_ERROR`.
- One transaction, following the shared Invitation row lock order.

Removal safety — before removing any `InvitationEvent` row, check for existing `RSVPEventSelection` rows referencing that invitation and event. If **any** selection references an event being removed, reject the **entire** replacement with `409 CONFLICT` and perform **zero** eligibility changes.

Do not delete RSVP selections, rewrite the RSVP, decline the RSVP, or silently orphan a selection. This preserves the documented invariant that every `RSVPEventSelection.eventId` remains eligible through `InvitationEvent`, and it prevents an `ACCEPTED` RSVP from being left with zero eligible attending events, which would contradict `EVENT_NOT_SELECTED`.

The operator workflow for changing eligibility after an RSVP is:

1. Use the OWNER RSVP override to remove or change the affected selection.
2. Then change eligibility.

A concurrent public RSVP submission and an eligibility replacement must serialize on the same Invitation row lock.

Response: `200 OK` with the resulting eligibility list, using the same shape as the invitation detail's `eligibility` relation.

## Admin RSVP Endpoints

Authentication: OWNER for reads, OWNER plus CSRF plus exact origin for the override.

### List RSVPs

`GET /api/admin/rsvps?status=ACCEPTED&eventId=7d98761a-b7fc-4a2e-8df4-69b6f22d85b4&search=smith&sortBy=updatedAt&sortOrder=desc&page=1&pageSize=25`

Query:

- `status`: `PENDING` | `ACCEPTED` | `DECLINED`.
- `eventId`: restricts to RSVPs with a selection for that event.
- `search`: matches the related `Invitation.displayName`, `Invitation.greetingName`, or a related `Invitee.fullName`.
- `sortBy`: `createdAt` | `updatedAt` | `status`. Default `updatedAt`.
- `sortOrder`: `asc` | `desc`. Default `desc`.
- `page`, `pageSize`: shared pagination.

Only persisted `RSVP` rows are returned. Invitations with **no** RSVP row are never synthesized into this list; they belong to the invitation list's `rsvpStatus=PENDING` filter.

Item:

```json
{
  "items": [
    {
      "id": "3d0a1e77-...",
      "invitation": {
        "id": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
        "displayName": "John & Jane Smith Family",
        "status": "ACTIVE"
      },
      "status": "ACCEPTED",
      "version": 3,
      "attendeeCount": 4,
      "attendingEventCount": 1,
      "createdAt": "2026-09-20T00:00:00.000Z",
      "updatedAt": "2026-09-29T10:15:00.000Z",
      "submittedByAdmin": false
    }
  ],
  "page": { "number": 1, "pageSize": 25, "totalItems": 1, "totalPages": 1 }
}
```

`submittedByAdmin` is a boolean derived from `submittedByAdminUserId != null`. No pass credential material appears in the list.

`attendeeCount` is `SUM(RSVPAttendee.quantity)`, not the number of attendee rows. `attendingEventCount` is the count of `RSVPEventSelection` rows where `attending = true`, not the total selection-row count.

### Get RSVP detail

`GET /api/admin/rsvps/{rsvpId}`

A missing RSVP returns `404 NOT_FOUND`.

Response: `id`, the safe invitation summary, `status`, `version`, event selections, attendees, `dietaryNotes`, `guestNote`, `createdAt`, `updatedAt`.

Admin submission metadata:

```json
{
  "submittedByAdmin": true,
  "adminUser": { "id": "...", "email": "owner@example.com" },
  "overrideReason": "Guest replied by phone"
}
```

`adminUser` and `overrideReason` are present only when available.

Check-in pass history may expose safe metadata only: `status`, `issuedAt`, `revokedAt`, `revocationReason`, `expiresAt`, `credentialVersion`.

Not exposed: `CheckinPass.tokenHash`, `qrPayload`, or any raw check-in credential. Phase 8 admin UI does not render or reissue guest QR credentials; that belongs to a separately locked later check-in/reprint use case. The credential is deterministically re-derivable if such a need arises.

### Override RSVP

`PUT /api/admin/invitations/{invitationId}/rsvp`

Authentication: OWNER plus CSRF plus exact origin.

Request: the same canonical public RSVP mutation fields, plus a mandatory `expectedVersion`, plus a mandatory `overrideReason`.

`overrideReason` is a string, trimmed, non-empty, and at most **500 Unicode code points**.

The admin endpoint **may bypass** the public `rsvpDeadlineAt` cutoff. That is the explicit meaning of the privileged OWNER override, and it is why this endpoint is a separate authenticated admin contract rather than a relaxation of the public one.

It **must not** bypass: the `ACTIVE` invitation requirement, event eligibility, attendee composition validation, capacity and plus-one rules, the canonical RSVP transition rules, the `CheckinPass` lifecycle, or `expectedVersion` concurrency. An archived invitation returns `409 CONFLICT`.

`expectedVersion` uses the same doctrine as public RSVP: `null` means create-only and conflicts when an RSVP row already exists; an integer must exactly equal the persisted `RSVP.version`. Mismatch returns `409 RSVP_VERSION_CONFLICT`.

The override uses the **same underlying RSVP lifecycle implementation** as the public path. `CheckinPass` semantics are not forked: the existing service must be reused or its transaction body extracted so an invitation-id entry point shares one implementation. A second, parallel RSVP state machine is not introduced.

Every successful OWNER override writes `submittedByAdminUserId` = the current OWNER id and `adminOverrideReason` = the normalized `overrideReason`. These two columns describe attribution for the **current** RSVP state, not an append-only audit history. A later successful public RSVP mutation clears both columns in the same successful RSVP write, so `submittedByAdmin` becomes `false`. Failed public mutations, including stale `expectedVersion`, eligibility, composition, deadline, or capacity failures, leave both attribution columns unchanged.

`guestNote` is **not** writable in the Phase 8 override. Its existing value is preserved. `dietaryNotes` follows the existing canonical RSVP rules, including clearing to `null` on decline.

Response: the admin RSVP detail shape.

Pass lifecycle, preserved exactly:

- `ACCEPTED -> ACCEPTED`: keep the active pass.
- `ACCEPTED -> DECLINED`: revoke the active pass.
- `DECLINED -> ACCEPTED`: issue a new pass; never reactivate the revoked one.
- `DECLINED -> DECLINED`: no active pass.

There is no admin-specific pass shortcut, and no raw `qrPayload` appears in the admin response.

## Admin Message Endpoints

**Locked by Phase 8 Slice 8D0.** Admin guest-message visibility and moderation are owned by Phase 8, and the listing, filtering, and moderation semantics below are now resolved.

Authentication: OWNER. Moderation requires OWNER plus CSRF plus exact origin.

### List guest messages

`GET /api/admin/messages?hidden=all&invitationId=...&sortBy=createdAt&sortOrder=desc&page=1&pageSize=25`

Query:

- `hidden`: `all` | `visible` | `hidden`. Default `all`.
- `invitationId`: restricts to one invitation.
- `sortBy`: `createdAt` only. Default `createdAt`.
- `sortOrder`: `asc` | `desc`. Default `desc`.
- `page`, `pageSize`: shared pagination.

There is **no** free-text message-body search in Phase 8.

Shared item DTO:

```json
{
  "items": [
    {
      "id": "a1b2c3d4-...",
      "invitation": {
        "id": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
        "displayName": "John & Jane Smith Family"
      },
      "authorName": "Aunt May",
      "message": "Wishing you both a lifetime of happiness.",
      "createdAt": "2026-09-29T10:15:00.000Z",
      "isHidden": false
    }
  ],
  "page": { "number": 1, "pageSize": 25, "totalItems": 1, "totalPages": 1 }
}
```

`authorName` is `null` for an anonymous submission; the admin UI shows an explicit anonymous state rather than an empty cell.

The response never includes the public credential, `publicTokenHash`, or auth/session data. Message body and `authorName` are admin-visible personal content and must not be deliberately logged.

### List messages for one invitation

`GET /api/admin/invitations/{invitationId}/messages`

Uses the **same** query parameters, pagination, sort rules, `hidden` filter, item DTO, and page envelope as the global list.

The `invitation` summary stays in each item on the scoped endpoint as well, so one generated type and one admin component serve both surfaces. No separate near-identical message DTO is introduced.

### Moderate a message

`PATCH /api/admin/messages/{messageId}`

Request:

```json
{ "isHidden": true }
```

`isHidden` is the only writable moderation field. There is no delete, no reason, and no moderation comment.

Response: `200 OK` with the updated shared admin guest-message item.

Set-to-value behavior is **idempotent**: `false -> true`, `true -> true`, `true -> false`, and `false -> false` all return `200`, and a same-value request makes no semantic change.

A missing message returns `404 NOT_FOUND`.

Phase 8 schema records **no** `hiddenAt`, `hiddenByAdminUserId`, or moderation timestamp. This is an explicit MVP limitation, not an oversight.

`isHidden` currently has **no public guest-facing effect**, because no public message wall and no public message read path exist. "Visible" does not mean publicly listed. It is an internal moderation state for current and future admin/reporting behavior.

Guest message content remains plain text in admin surfaces: no `dangerouslySetInnerHTML`, no Markdown interpretation, no HTML or link auto-conversion.

## Admin Response Privacy

**Locked by Phase 8 Slice 8D0.** Admin authentication is not a reason to return raw database models. Admin responses use explicit DTOs, and the fields below are governed individually.

| Field                                                                                 | Allowed surface                                                                                                                  | Forbidden surface                                                                         | Why                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicUrl` (the derived raw public credential, inside the URL)                       | `GET /api/admin/invitations/{id}/public-url` and `POST /api/admin/invitations/{id}/regenerate-token` **only**                    | Invitation list, Invitation detail, and every unrelated admin response; deliberate logs   | It is the copyable invitation link; the OWNER cannot distribute it otherwise. It is bearer material, so it travels only through its two explicit endpoints and must never be deliberately logged. |
| `publicTokenVersion`                                                                  | Invitation **detail**, `public-url` response, `regenerate-token` response                                                        | Invitation **list** item and every unrelated admin summary                                | Operational metadata and the concurrency token for regeneration. Not a secret and does not resolve a link by itself.                                                                              |
| Raw `publicCredential` outside `publicUrl`                                            | —                                                                                                                                | Every admin response, including list items, detail responses, and messages                | Only the two explicit credential endpoints may surface it, and only as part of the URL.                                                                                                           |
| `publicTokenHash`                                                                     | —                                                                                                                                | Every admin response, and all logs                                                        | Internal lookup hash with no admin use.                                                                                                                                                           |
| `qrPayload`                                                                           | —                                                                                                                                | Every Phase 8 admin response                                                              | Bearer check-in credential material. Phase 8 admin UI never renders or reissues guest QR credentials; a later check-in/reprint contract decides separately.                                       |
| `CheckinPass.tokenHash`                                                               | —                                                                                                                                | Every admin response, and all logs                                                        | Internal credential hash.                                                                                                                                                                         |
| Pass status/`issuedAt`/`revokedAt`/`revocationReason`/`expiresAt`/`credentialVersion` | Invitation detail pass history, RSVP detail                                                                                      | Unrelated admin summaries                                                                 | Operational lifecycle metadata with no credential value.                                                                                                                                          |
| `sessionToken`, `sessionTokenHash`, `csrfTokenHash`                                   | The locked Slice 8B0 auth responses: the CSRF token is returned only by the authorized auth endpoints and only as designed there | Every other admin response                                                                | Locked by Slice 8B0 and not reopened.                                                                                                                                                             |
| `passwordHash`                                                                        | —                                                                                                                                | Every admin response                                                                      | Locked by Slice 8B0 and not reopened.                                                                                                                                                             |
| `AdminSession.ipAddress` / `userAgent`                                                | —                                                                                                                                | Every admin response                                                                      | Locked by Slice 8B0 and not reopened.                                                                                                                                                             |
| `GuestMessage.message` / `authorName`                                                 | Admin guest-message list, invitation-scoped message list, and the moderation response                                            | Unrelated admin endpoints (invitation/dashboard/RSVP summaries), and all logs             | Required for moderation; plain text only. Admin-visible personal content is not log material.                                                                                                     |
| `Invitation.notes`                                                                    | Invitation **detail**                                                                                                            | Invitation **list** item, the public invitation projection, and unrelated admin summaries | Admin-only management data. `PATCH` Invitation can write it; the public contract never returns it.                                                                                                |
| `RSVP.dietaryNotes`                                                                   | RSVP admin **detail**, and canonical RSVP responses where already contractually appropriate                                      | Unrelated admin summaries                                                                 | Operational catering need.                                                                                                                                                                        |
| `RSVP.guestNote`                                                                      | RSVP admin **detail**                                                                                                            | Unrelated admin summaries; the public projection                                          | Readable admin-side and read-only in Phase 8: the OWNER override does not write it, and the existing value is preserved. It is not globally never-returned.                                       |

`publicTokenVersion` is safe admin operational metadata. `publicUrl` is not: it is credential-bearing and confined to its two explicit endpoints. Every other credential, hash, or session secret is never returned outside the authorized auth responses.

## Admin Import Endpoints

**Phase ownership: Phase 9.** The template, parsing, preview, and commit contract is locked by Phase 9 Slice 9A. Import is **create-only**: it creates new `Invitation`, `Invitee`, and `InvitationEvent` rows and never updates, upserts, or merges an existing record. See `TECHNICAL-ARCHITECTURE.md` ("Import Architecture") for parser and validation responsibilities, and `DATABASE-SCHEMA.md` (`GuestImportPreview`, `GuestImportBatch`) for persistence consequences.

### Import template

Base columns, in this exact order, followed by zero or more event eligibility columns:

| Column                        | Maps to                                     |
| ----------------------------- | ------------------------------------------- |
| `displayName`                 | `Invitation.displayName`                    |
| `greetingName`                | `Invitation.greetingName`                   |
| `allowPlusOne`                | `Invitation.allowPlusOne`                   |
| `maxAdditionalChildren`       | `Invitation.maxAdditionalChildren`          |
| `rsvpDeadlineLocal`           | normalized into `Invitation.rsvpDeadlineAt` |
| `notes`                       | `Invitation.notes`                          |
| `invitees`                    | `Invitee[]`                                 |
| `event:<slug>` (zero or more) | `InvitationEvent` eligibility               |

Header rules:

- Matching is **exact** after removing an optional UTF-8 BOM from the first header. No aliases, no case-insensitive matching, no silent rename of a misspelled header.
- Event eligibility columns use the stable spreadsheet-facing identifier `Event.slug`. Event UUIDs never appear in the template.
- Backend-owned fields are never accepted from a spreadsheet: `id`, `status`, `publicCredential`, `publicTokenHash`, `publicTokenVersion`, `openCount`, `firstOpenedAt`, `lastOpenedAt`, `createdAt`, `updatedAt`, `archivedAt`, `displayOrder`, `GuestImportBatch` fields, RSVP fields, and `CheckinPass` fields.

One source row is one household and equals one `Invitation`. `includeRowNumbers` therefore refers to source household row numbers, and no household spans multiple spreadsheet rows.

### Value normalization

- `allowPlusOne`, `event:<slug>`: boolean. Accepted textual literals are only `true` and `false`, trimmed and case-insensitive; XLSX native boolean cells are also accepted. `yes`/`no`, `y`/`n`, `1`/`0`, and `on`/`off` are rejected. A blank optional eligibility cell means `false`; a blank `allowPlusOne` is a validation error.
- `maxAdditionalChildren`: non-negative safe integer. CSV accepts decimal integer text only; XLSX accepts an integer numeric cell or decimal integer text. Negative, fractional, `NaN`-like, and scientific strings are rejected.
- `rsvpDeadlineLocal`: optional **text** in the exact format `YYYY-MM-DD HH:mm`, interpreted as `Asia/Jakarta` and normalized to a canonical UTC instant. Blank means `null`. The column is deliberately not named `rsvpDeadlineAt`. Ambiguous formats such as `16/01/2027` or `01/16/2027`, and Excel date-serial or date-formatted numeric cells, are rejected; workbook locale and timezone are never guessed.
- `invitees`: JSON array of objects with exactly `fullName`, `category`, and optional `label`. `category` accepts `ADULT` and `CHILD`, trimmed and case-insensitive, canonicalized to the uppercase literal. `displayOrder` is not accepted; invitee display order is assigned server-side from array order starting at `0`. Duplicate invitee names are allowed and are not by themselves warnings. At least one invitee is required per imported household.

### Validate import (preview)

`POST /api/admin/imports/guest/validate`

Authentication: OWNER plus CSRF. Origin validation applies.

Request: `multipart/form-data` carrying exactly one file.

- Accepted: `.csv`, `.xlsx`.
- Rejected: `.xls`, `.xlsm`, `.xlsb`, and arbitrary ZIP/Office payloads. Extension, declared media type where useful, and actual file signature/content are all validated; none is trusted alone.
- CSV: UTF-8 (BOM allowed), comma delimiter, standard double-quote quoting with doubled-quote escaping, CRLF or LF, quoted multiline cells supported, first record is the header, completely blank records ignored, no delimiter auto-detection, no legacy codepage detection. Row numbers are record positions including the header, so the first data row is `2`; a multiline quoted cell does not create extra row numbers.
- XLSX: `.xlsx` only, with a visible worksheet named exactly `Invitations`. Other worksheets are ignored. Header is row 1 and data starts at row 2. Missing or hidden target sheet is rejected. Within the target used range, formulas (and their cached values), merged cells, and Excel date-serial cells for `rsvpDeadlineLocal` are rejected. Formulas are never evaluated, external links are never followed, and the parser never makes network requests from workbook content.
- Limits: maximum upload size **5 MiB**; maximum **500** household data rows counted after blank records are ignored. Exceeding either limit is rejected before business parsing. These are Phase 9 operational limits, not permanent domain limits. XLSX parsing uses bounded worksheet dimensions rather than trusting a workbook's declared range.

Parsing and authoritative validation happen server-side; the browser is never the validation authority.

Response:

```json
{
  "previewId": "temporary_preview_id",
  "expiresAt": "2027-01-16T11:30:00.000Z",
  "summary": {
    "totalRows": 100,
    "validRows": 98,
    "errorRows": 2,
    "warningRows": 3
  },
  "rows": [
    {
      "rowNumber": 2,
      "status": "VALID_WITH_WARNINGS",
      "errors": [],
      "warnings": [
        {
          "rowNumber": 2,
          "column": "displayName",
          "field": "displayName",
          "code": "POSSIBLE_DUPLICATE",
          "message": "Possible duplicate household by normalized display name."
        }
      ],
      "parsed": {
        "displayName": "John & Jane Smith Family",
        "greetingName": null,
        "allowPlusOne": false,
        "maxAdditionalChildren": 2,
        "rsvpDeadlineLocal": "2027-01-16 18:30",
        "rsvpDeadlineAt": "2027-01-16T11:30:00.000Z",
        "invitees": [
          { "fullName": "John Smith", "category": "ADULT", "label": null },
          { "fullName": "Alice Smith", "category": "CHILD", "label": null }
        ],
        "eligibleEventSlugs": ["holy-matrimony", "reception"]
      }
    }
  ]
}
```

`parsed` contains the authoritative server-normalized household preview for rows that can be safely normalized. The browser must render from these values rather than reparsing the uploaded file. `rsvpDeadlineLocal` is the normalized source/local value in `YYYY-MM-DD HH:mm` interpreted as `Asia/Jakarta`; `rsvpDeadlineAt` is the canonical UTC ISO instant used by business creation. `eligibleEventSlugs` contains selected event slugs only, never Event UUIDs. Invitees contain only normalized `fullName`, `category`, and nullable `label`; server-assigned `displayOrder`, internal IDs, timestamps, credential material, and raw source cells are not part of the preview response.

Row statuses are `VALID`, `VALID_WITH_WARNINGS`, and `ERROR`. Each row issue is structured:

```json
{
  "rowNumber": 2,
  "column": "rsvpDeadlineLocal",
  "field": "rsvpDeadlineAt",
  "code": "INVALID_DATE",
  "message": "..."
}
```

`column` is the source spreadsheet column and `field` is the mapped domain field. Where an issue applies to the whole row, both are `null`. Clients never parse `message` to determine meaning.

Row issue codes are a closed minimum vocabulary: `REQUIRED_FIELD`, `INVALID_VALUE`, `INVALID_JSON`, `INVALID_DATE`, `UNKNOWN_EVENT`, `INACTIVE_EVENT`, `INVALID_INVITEE`, `POSSIBLE_DUPLICATE`. File-level and template-level failures are normal admin API errors rather than synthetic row issues.

Errors vs warnings:

- Errors block committing a row.
- Warnings require an explicit OWNER decision but do not automatically block.
- Possible duplicates are warnings unless a true uniqueness constraint is violated, and are never merged automatically.
- Preview is not a committed `GuestImportBatch`, and validation creates no business invitation data.

### Commit import

`POST /api/admin/imports/guest/commit`

Authentication: OWNER plus CSRF. Origin validation applies. Content type is `application/json`.

Request:

```json
{
  "previewId": "temporary_preview_id",
  "includeRowNumbers": [2, 3, 4],
  "acknowledgedWarningRowNumbers": [2]
}
```

The parsed household payload is never sent back from the browser. The server commits from its own stored normalized preview.

Selection rules:

- `includeRowNumbers` must be non-empty, must contain unique row numbers, may contain `VALID` rows, and may contain `VALID_WITH_WARNINGS` rows only when those rows are also acknowledged. It must never include `ERROR` rows.
- `acknowledgedWarningRowNumbers` must be unique and must refer to warning rows in the same preview. Acknowledgment never converts an error row into a valid row.
- Server-side validation is authoritative; client-side enforcement alone is never sufficient.

Response:

```json
{
  "importBatch": {
    "id": "fc9ddfd3-f2c5-4a22-8561-970e5f21f204",
    "status": "COMMITTED",
    "createdInvitationCount": 10,
    "createdInviteeCount": 30,
    "warningCount": 1
  }
}
```

Revalidation and transaction:

- Commit revalidates inside the transaction: preview not expired, preview owned by the current OWNER, selected rows still valid, current Event still exists and is active when selected, canonical Invitation and Invitee business validation, and the warning/duplicate state needed for a safe commit.
- If current state differs materially from preview — a new blocking error, a new unacknowledged warning, or changed event eligibility — commit performs **zero** business writes and returns a stale-preview conflict.
- All selected rows commit in one transaction. Invitation creation, invitee creation, event eligibility, and credential version/hash initialization occur in that same transaction. If any selected row fails, all selected rows roll back; there is no partially imported selected set.
- Exactly one successful `GuestImportBatch` is written per successful commit. Failed attempts create no batch row.
- Import does not pre-create `RSVP`, `RSVPAttendee`, or `RSVPEventSelection`. An imported invitation follows the same lazy RSVP lifecycle as an invitation created through the admin create endpoint.

Commit errors use the standard admin envelope:

- `409 IMPORT_PREVIEW_STALE` — current state materially differs from the preview; a new preview is required.
- `409 IMPORT_PREVIEW_EXPIRED` — the uncommitted preview passed its 30-minute lifetime. The preview is never silently regenerated; the file must be uploaded and validated again.
- `409 IMPORT_PREVIEW_ALREADY_COMMITTED` — the preview was already committed with a different selection.

Idempotency:

- The preview is the idempotency boundary. A deterministic commit fingerprint is computed from the canonical `previewId` plus the sorted unique `includeRowNumbers` and `acknowledgedWarningRowNumbers`.
- The first successful commit atomically marks the preview committed, records the fingerprint, links the committed `GuestImportBatch`, and stores the minimal committed receipt.
- Re-committing the same preview with the same fingerprint returns the same committed result and creates no additional invitations.
- Re-committing a committed preview with a different fingerprint returns `409 IMPORT_PREVIEW_ALREADY_COMMITTED`.

Lost-response recovery is explicit only. `admin-web` never automatically replays a commit after a network interruption, timeout, `5xx`, malformed success, or CSRF refresh. The operator may explicitly resubmit the exact same selection; because the commit is idempotent for the same fingerprint, the server returns the original result if the first request actually succeeded.

## Admin Staff Account Endpoints

**Phase ownership: Phase 10C.** Staff management exists only so venue operators have personal limited accounts. It is not a general user-administration platform and does not create additional OWNERs.

### List staff

`GET /api/admin/staff?page=1&pageSize=25&status=ACTIVE`

Authentication: OWNER. `CHECKIN_STAFF` is forbidden.

Response:

```json
{
  "items": [
    {
      "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
      "email": "usher@example.com",
      "role": "CHECKIN_STAFF",
      "status": "ACTIVE",
      "mustChangePassword": false,
      "createdAt": "2026-10-13T10:00:00.000Z",
      "lastLoginAt": null
    }
  ],
  "page": { "number": 1, "pageSize": 25, "totalItems": 1, "totalPages": 1 }
}
```

Never returned: password hashes, session token hashes, CSRF hashes, raw temporary credentials, IP address, or user-agent.

### Create staff

`POST /api/admin/staff`

Authentication: OWNER plus CSRF.

Request:

```json
{
  "email": "usher@example.com"
}
```

Response `201 Created`:

```json
{
  "staff": {
    "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
    "email": "usher@example.com",
    "role": "CHECKIN_STAFF",
    "status": "ACTIVE",
    "mustChangePassword": true
  },
  "temporaryPassword": "one-time display value"
}
```

The temporary password is generated with cryptographic randomness, is shown only in this creation response, is never persisted in plaintext, is never logged, and must be replaced on first login. A duplicate normalized email returns `409 CONFLICT`.

### Disable or reactivate staff

`PATCH /api/admin/staff/{staffId}`

Authentication: OWNER plus CSRF.

Request:

```json
{ "status": "DISABLED" }
```

Allowed status values: `ACTIVE`, `DISABLED`. Disabling revokes all active sessions for that user immediately. Reactivation does not create a session and may require a password reset if credentials are unknown.

Errors: `404 NOT_FOUND`, `409 CONFLICT` if the target is not `CHECKIN_STAFF`.

### Reset staff credentials

`POST /api/admin/staff/{staffId}/reset-password`

Authentication: OWNER plus CSRF.

Response:

```json
{
  "staff": {
    "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
    "email": "usher@example.com",
    "role": "CHECKIN_STAFF",
    "status": "ACTIVE",
    "mustChangePassword": true
  },
  "temporaryPassword": "one-time display value"
}
```

Side effects: replaces the password hash, sets `mustChangePassword = true`, and revokes all existing sessions for that staff account. It never returns or exposes an existing password. Errors: `404 NOT_FOUND`, `409 CONFLICT` if the target is not `CHECKIN_STAFF`.

## Admin Check-in Endpoints

**Phase ownership: Phase 10D.** Phase 10B locks this contract only; no endpoint is implemented by the contract-lock slice. Authorized roles are `OWNER` and `CHECKIN_STAFF` unless stated otherwise. All unsafe endpoints require exact admin Origin validation and session-bound CSRF.

### Active check-in Events

`GET /api/admin/checkin/events`

Authentication: OWNER or CHECKIN_STAFF.

Returns the minimal active Event picker. This endpoint does not prove that any household may attend an event.

```json
{
  "events": [
    {
      "id": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
      "name": "Holy Matrimony",
      "slug": "ceremony",
      "startsAt": "2027-01-09T03:00:00.000Z"
    }
  ]
}
```

MVP staff event scope: every authenticated CHECKIN_STAFF may select any active Event. Per-staff Event assignment is deferred.

### Validate QR/check-in credential

`POST /api/admin/checkin/validate`

Authentication: OWNER or CHECKIN_STAFF plus CSRF.

This endpoint is read/validation only. It must not create `CheckinRecord`, reserve capacity, or mutate pass state.

Request:

```json
{
  "qrPayload": "opaque_backend_credential_payload",
  "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4"
}
```

Response `200 OK`:

```json
{
  "status": "VALID",
  "invitation": {
    "id": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
    "displayName": "John & Jane Smith Family"
  },
  "event": {
    "id": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
    "name": "Holy Matrimony"
  },
  "expectedAttendeeCount": 4,
  "alreadyCheckedIn": false,
  "previousCheckin": null
}
```

If already confirmed, the response may be `200 OK` with `status: "ALREADY_CONFIRMED"` and `previousCheckin` containing only `checkedInAt`, `attendeeCount`, `method`, and minimal operator identity needed for dispute resolution. It must not expose the raw `qrPayload`, `CheckinPass.tokenHash`, public invitation URL, full invitee roster, guest notes, guest messages, import history, or private RSVP detail.

Validation:

- Parse the 43-character opaque check-in credential; malformed input returns `422 QR_INVALID`.
- Resolve `SHA-256(qrPayload)`/credential hash using the existing check-in credential derivation and hash rules.
- Require active pass, active invitation, accepted RSVP, active Event, `InvitationEvent` eligibility, attending `RSVPEventSelection`, and expected attendee capacity.
- Check whether `CheckinRecord` already exists for Invitation + Event.

Errors:

- `422 QR_INVALID`
- `422 QR_REVOKED`
- `404 INVITATION_NOT_AVAILABLE`
- `422 EVENT_NOT_ALLOWED`
- `422 EVENT_NOT_SELECTED`
- `409 CHECKIN_ALREADY_CONFIRMED`

### Confirm QR check-in

`POST /api/admin/checkin/confirm`

Authentication: OWNER or CHECKIN_STAFF plus CSRF.

Request:

```json
{
  "qrPayload": "opaque_backend_credential_payload",
  "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
  "attendeeCount": 4
}
```

The request never accepts `confirmedByAdminUserId`; the server derives the operator from the authenticated session.

Response `201 Created`:

```json
{
  "checkinRecord": {
    "id": "d7c77944-633c-443b-a476-8bb16b2792de",
    "method": "QR",
    "attendeeCount": 4,
    "checkedInAt": "2026-10-13T10:00:00.000Z",
    "confirmedBy": {
      "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
      "email": "usher@example.com",
      "role": "CHECKIN_STAFF"
    }
  }
}
```

Transaction:

1. Begin transaction.
2. Lock Invitation row `FOR UPDATE` first.
3. Reload current RSVP, Event, pass, eligibility, and selected event state.
4. Re-run all validation.
5. Check existing `CheckinRecord` for Invitation + Event.
6. Validate `1 <= attendeeCount <= RSVPEventSelection.expectedAttendeeCount`.
7. Insert `CheckinRecord` with `method = QR`, `checkinPassId`, and the authenticated `AdminUser.id`.
8. Commit.

Concurrent confirmations:

- Unique Invitation/Event constraint is the final guard.
- The loser returns `409 CHECKIN_ALREADY_CONFIRMED`.
- No partial record is created on validation failure.

### Manual guest lookup

`GET /api/admin/checkin/search?query=smith&eventId=7d98761a-b7fc-4a2e-8df4-69b6f22d85b4`

Authentication: OWNER or CHECKIN_STAFF.

Rules:

- `query` is required, trimmed, and must have a reasonable minimum length such as 2 Unicode code points.
- Results are bounded, default/max 10 unless implementation locks another small operational value.
- Search is over minimal household identifiers needed for venue lookup, such as display name and greeting name. It is not a bulk export and not a general Invitation list.

Response:

```json
{
  "items": [
    {
      "invitation": {
        "id": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
        "displayName": "John & Jane Smith Family"
      },
      "event": {
        "id": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
        "name": "Holy Matrimony"
      },
      "expectedAttendeeCount": 4,
      "alreadyCheckedIn": false
    }
  ]
}
```

Never returned: raw credentials, credential hashes, public URL, notes, full invitee roster, guest messages, import history, or unrelated admin detail fields.

### Manual check-in

`POST /api/admin/checkin/manual-confirm`

Authentication: OWNER or CHECKIN_STAFF plus CSRF.

Request:

```json
{
  "invitationId": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
  "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
  "attendeeCount": 4
}
```

Manual confirmation uses the same backend attendance domain service and transaction as QR confirmation after invitation resolution. It records `method = MANUAL`, no `checkinPassId`, and the authenticated operator's `AdminUser.id`. Validation, attendee-count bounds, duplicate handling, archive behavior, and concurrency behavior match QR confirmation.

### Manual check-in status reconciliation

`POST /api/admin/checkin/manual-status`

Authentication: OWNER or CHECKIN_STAFF plus CSRF.

Purpose: read-only authoritative attendance status for a previously selected exact household and exact Event. This is the recovery path for manual confirmation responses that are lost after submission; it does not create, update, retry, or correct a check-in.

Request:

```json
{
  "invitationId": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
  "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4"
}
```

Response `200 OK`, not confirmed:

```json
{
  "status": "NOT_CONFIRMED",
  "alreadyCheckedIn": false,
  "previousCheckin": null
}
```

Response `200 OK`, already confirmed:

```json
{
  "status": "ALREADY_CONFIRMED",
  "alreadyCheckedIn": true,
  "previousCheckin": {
    "checkedInAt": "2026-10-13T10:00:00.000Z",
    "attendeeCount": 4,
    "method": "MANUAL",
    "confirmedBy": {
      "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
      "email": "usher@example.com",
      "role": "CHECKIN_STAFF"
    }
  }
}
```

Rules:

- The lookup uses exact `Invitation.id` plus exact `Event.id`; a check-in for Event A is never interpreted as status for Event B.
- The response does not include household display name, Event name, RSVP details, invitees, contact data, public URL, raw public credential, `qrPayload`, credential hashes, pass history, guest messages, notes, or import history.
- A historical `CheckinRecord` remains discoverable after the Invitation is archived, after display names change, after search ordering changes, or when the household no longer appears in the first ten manual-search results.
- Historical attendance status is separate from current eligibility to perform a new check-in. Archived invitations remain ineligible for new validation/confirmation.
- The status read takes the same Invitation-row lock order used by confirmation. If a status request queues behind an in-flight confirmation that already reached the Invitation lock, it observes the committed confirmation after the lock is released.
- `NOT_CONFIRMED` means only that no matching committed `CheckinRecord` was observed at the authoritative read point. It does not prove that an earlier request cannot still reach the database and commit later. The frontend must keep an uncertain recovery state and allow explicit rechecking; it must not automatically replay `manual-confirm`.

Errors:

- `400 BAD_REQUEST` for malformed body, unsupported fields, or invalid UUIDs.
- `401 UNAUTHENTICATED`.
- `403 CSRF_INVALID` or `403 FORBIDDEN`.
- `404 INVITATION_NOT_AVAILABLE` for unknown Invitation IDs, using the minimized existing error envelope.

### Post-check-in RSVP mutation error

After any `CheckinRecord` exists for an invitation, public RSVP PUT and OWNER RSVP override for that invitation return:

```json
{
  "error": {
    "code": "RSVP_LOCKED_AFTER_CHECKIN",
    "message": "RSVP is locked after check-in."
  }
}
```

Status: `409 Conflict`. This check is performed inside the same Invitation-row-locked transaction as the RSVP mutation or check-in confirmation. Read-only RSVP retrieval remains allowed.

### Check-in lost-response recovery

No request-level idempotency key is added. If the browser sees a network failure, timeout, ambiguous `5xx`, or malformed success after submitting confirmation, the UI enters an uncertain state and must not automatically replay the confirm request. The operator explicitly revalidates the same QR/manual household and Event:

- If the first request committed, validation returns the authoritative already-confirmed state.
- If nothing committed, the UI may offer a new explicit confirmation.
- If another operator confirmed in between, the UI shows that authoritative state and must not attribute it to the first operator.

## Admin Reports and Export

**Phase ownership: Phase 11.** Reporting is outside Phase 8. The Phase 8 dashboard is deliberately narrowed to the metric set defined under "Admin Dashboard"; it is not the reporting summary.

### Report summary

`GET /api/admin/reports/summary?includeArchived=false`

Authentication: OWNER.

Returns a broader metric set than the Phase 8 dashboard, with archived invitations excluded by default unless explicitly included.

### CSV export

`GET /api/admin/reports/export.csv?type=rsvp&includeArchived=false`

Authentication: OWNER.

Supported MVP export types must be finalized before implementation. Initial likely types: `invitations`, `rsvp`, `dietary`, `checkin`.

Response: `text/csv`.

XLSX export is not required for MVP.
