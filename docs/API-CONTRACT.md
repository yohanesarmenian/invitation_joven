# API Contract

This document defines intended HTTP behavior. The future NestJS OpenAPI output is the executable contract source, but it must follow these semantics unless higher-level docs change.

## Conventions

Base paths:

- Public: `/api/public`
- Admin: `/api/admin`

Response format:

- Success responses return JSON objects.
- List responses use `{ "items": [], "page": {...} }`.
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

| Code | Status | Meaning |
|---|---:|---|
| `INVITATION_NOT_AVAILABLE` | 404 | Public credential is malformed, unknown, stale, archived, or otherwise unavailable. Do not reveal which. |
| `RSVP_VERSION_CONFLICT` | 409 | Submitted `expectedVersion` does not match current persisted RSVP state: a non-null integer differs from the reloaded `RSVP.version`, or `expectedVersion: null` is sent when an RSVP row already exists. |
| `RSVP_DEADLINE_PASSED` | 422 | Public RSVP create or update was submitted after the invitation RSVP cutoff instant. |
| `EVENT_NOT_ALLOWED` | 422 | Invitation is not eligible for the selected event. |
| `EVENT_NOT_SELECTED` | 422 | RSVP does not select attendance for the event; also covers an `ACCEPTED` RSVP that selects zero attending events. |
| `PLUS_ONE_NOT_ALLOWED` | 422 | RSVP included plus-one without permission. |
| `ADDITIONAL_CHILD_LIMIT_EXCEEDED` | 422 | Additional child quantity exceeds allowance. |
| `RSVP_ATTENDEE_INVALID` | 422 | RSVP attendee rows violate type/quantity/reference rules. |
| `QR_INVALID` | 404 or 422 | Admin scanner received invalid/non-resolvable credential; response must not leak sensitive internals. |
| `QR_REVOKED` | 422 | Admin scanner resolved a revoked/expired pass. |
| `CHECKIN_ALREADY_CONFIRMED` | 409 | Invitation already has confirmed attendance for the event. |
| `INVALID_CREDENTIALS` | 401 | Admin login failed. Covers unknown email, wrong password, and a `DISABLED` account, indistinguishably. |
| `TOO_MANY_LOGIN_ATTEMPTS` | 429 | Admin login was rejected by the login throttle. Must not indicate whether the account exists. |
| `UNAUTHENTICATED` | 401 | Admin request without a usable session: missing cookie, malformed session token, unknown session, expired session, idle-expired session, revoked session, or a session whose `AdminUser` is `DISABLED`. |
| `FORBIDDEN` | 403 | Authenticated session without the required role. Reserved for authorization doctrine; normally unreachable while `OWNER` is the only role. |
| `CSRF_INVALID` | 403 | Unsafe authenticated admin request failed CSRF or admin-origin validation. Does not disclose which check failed. |

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

| RSVP transition | Pass result | Public `checkinPass` / QR result |
| --- | --- | --- |
| no RSVP row | none | `null` — no QR |
| no RSVP row -> `ACCEPTED` | one new `ACTIVE` pass | `{ status, issuedAt, qrPayload }` — new QR |
| `PENDING`/`ACCEPTED` -> `ACCEPTED` | same pass retained | same `qrPayload` — QR unchanged |
| `ACCEPTED` -> `DECLINED` | active pass revoked | `null` — QR disappears |
| `DECLINED` -> `ACCEPTED` | new pass issued | new `qrPayload` — new QR |
| `DECLINED` -> `DECLINED` | none | `null` — no QR |

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

**Locked by Phase 8 Slice 8B0.** These three endpoints are the whole admin authentication surface. First-OWNER creation is an operator CLI and is deliberately not an HTTP route; see `TECHNICAL-ARCHITECTURE.md` (D2).

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

Never returned: session id, session token, `sessionTokenHash`, `csrfTokenHash`, `passwordHash`, `ipAddress`, `userAgent`.

Errors: `401 UNAUTHENTICATED` for any unusable session.

### Logout

`POST /api/admin/auth/logout`

Authentication: admin session cookie **plus** CSRF token. Origin validation also applies.

Response: `204 No Content`.

Side effects: sets `revokedAt` on the **current** `AdminSession` only, and clears the current session cookie with matching name, path, and environment attributes. Other OWNER sessions are unaffected. See `TECHNICAL-ARCHITECTURE.md` (D13).

Errors: `401 UNAUTHENTICATED`, `403 CSRF_INVALID`.

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

## Admin Dashboard

`GET /api/admin/dashboard`

Authentication: OWNER.

Default active metrics exclude archived invitations, while archived count is shown separately.

Response:

```json
{
  "invitations": {
    "totalActive": 118,
    "archived": 2,
    "openedActive": 90
  },
  "rsvp": {
    "pending": 40,
    "accepted": 70,
    "declined": 10
  },
  "headcount": {
    "expectedTotal": 180,
    "expectedByEvent": [
      { "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4", "count": 120 }
    ],
    "adults": 140,
    "children": 40
  },
  "checkin": {
    "checkedInHouseholds": 30,
    "checkedInAttendeeCount": 70,
    "byEvent": [
      { "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4", "households": 30, "attendees": 70 }
    ],
    "notYetArrivedAcceptedInvitations": 40
  }
}
```

## Admin Invitation Endpoints

### List invitations

`GET /api/admin/invitations?status=ACTIVE&rsvpStatus=ACCEPTED&search=smith&page=1&pageSize=25`

Authentication: OWNER.

Response: paginated invitation summaries.

### Create invitation

`POST /api/admin/invitations`

Authentication: OWNER plus CSRF.

Request:

```json
{
  "displayName": "John & Jane Smith Family",
  "greetingName": "John & Jane",
  "allowPlusOne": false,
  "maxAdditionalChildren": 2,
  "eventIds": ["7d98761a-b7fc-4a2e-8df4-69b6f22d85b4"],
  "invitees": [
    { "fullName": "John Smith", "category": "ADULT" },
    { "fullName": "Alice Smith", "category": "CHILD" }
  ]
}
```

Response: `201 Created` with invitation detail and public URL.

Side effects:

- Creates Invitation with `public_token_version = 1`.
- Derives public credential.
- Stores `public_token_hash`.
- Creates InvitationEvent rows.
- Creates invitees.
- Does not create an RSVP row. Phase 5 locks lazy RSVP creation: `expectedVersion: null` create-only semantics depend on the absence of an RSVP row, so no empty/`PENDING` RSVP row may be pre-created.

### Get invitation detail

`GET /api/admin/invitations/{invitationId}`

Authentication: OWNER.

Response: full admin detail including invitees, eligibility, RSVP, messages summary, pass status/history, CheckinRecord history, open aggregates, and current public URL if the backend chooses to include it. Must not expose credential hashes.

### Update invitation

`PATCH /api/admin/invitations/{invitationId}`

Authentication: OWNER plus CSRF.

Request: partial invitation fields, invitee updates handled by invitee endpoints unless implementation chooses nested update with documented transaction.

Validation:

- Must not break existing RSVP/check-in history silently.
- Event eligibility changes that can affect RSVP/check-in must follow shared Invitation row lock order.

### Archive invitation

`POST /api/admin/invitations/{invitationId}/archive`

Authentication: OWNER plus CSRF.

Request:

```json
{ "reason": "No longer attending" }
```

Response: updated invitation status.

Side effect: preserves all associated records and makes public invitation, RSVP, messages, QR validation, and check-in unavailable.

### Regenerate public URL

`POST /api/admin/invitations/{invitationId}/regenerate-token`

Authentication: OWNER plus CSRF.

Response:

```json
{ "publicUrl": "https://example.com/i/new-derived-credential" }
```

Transaction:

1. Lock Invitation.
2. Increment `public_token_version`.
3. Derive new credential.
4. Store new `public_token_hash`.
5. Return new public URL.

Old credential becomes invalid immediately. Deterministic retry/idempotency semantics must be finalized before this endpoint ships.

**Carried forward (Phase 8 Slice 8B0).** The retry/idempotency contract for this endpoint is deliberately **not** resolved by the auth lock. It is carried explicitly into the Slice 8D0 admin-management contract audit, together with the rest of the admin-domain surface.

### Copy invitation URL

`GET /api/admin/invitations/{invitationId}/public-url`

Authentication: OWNER.

Behavior: backend re-derives the current credential from server secret, Invitation id, and current `public_token_version`, then returns the protected OWNER-only URL. Plaintext credential is not persisted.

## Admin Invitee Endpoints

- `POST /api/admin/invitations/{invitationId}/invitees`
- `PATCH /api/admin/invitees/{inviteeId}`
- `DELETE /api/admin/invitees/{inviteeId}` only if safe; otherwise use future inactive/archive behavior.

Authentication: OWNER plus CSRF for mutations.

Validation:

- Do not delete invitees referenced by current RSVP state or historical records unless a documented preservation strategy exists.

## Admin RSVP Endpoints

### List RSVPs

`GET /api/admin/rsvps?status=PENDING&eventId=7d98761a-b7fc-4a2e-8df4-69b6f22d85b4&page=1&pageSize=25`

Authentication: OWNER.

### Get RSVP detail

`GET /api/admin/rsvps/{rsvpId}`

Authentication: OWNER.

### Override RSVP

`PUT /api/admin/invitations/{invitationId}/rsvp`

Authentication: OWNER plus CSRF.

Request shape matches public RSVP plus:

```json
{
  "expectedVersion": 3,
  "overrideReason": "Guest replied by phone"
}
```

Validation:

- Same domain validations as public RSVP unless OWNER-specific override is explicitly allowed and audited.
- Requires override reason.
- Follows shared Invitation row lock order.
- Uses the same `expectedVersion` semantics as public RSVP, including `null` for create-only.
- This endpoint is not a public post-deadline override. Phase 5 defines no public override after the cutoff; any OWNER post-deadline override belongs to a separate authenticated admin contract.

State transitions: same RSVP/check-in pass lifecycle as public.

## Admin Message Endpoints

**Deferred. Not part of Phase 7 or Phase 8's auth foundation.** These operations require the OWNER admin session foundation owned by Phase 8, and `apps/admin-web` has no API client or authentication. Phase 7 owns public guest-message submission only.

**Phase ownership (locked in Phase 8 Slice 8B0).** Admin guest-message visibility and moderation **is owned by Phase 8**, but it is **not** part of Phase 8's auth-foundation slices 8B and 8C. It requires its own admin-domain contract lock (Slice 8D0) before implementation. Phase 8 is therefore not complete once auth and the admin shell ship.

- `GET /api/admin/messages?page=1&pageSize=25`
- `GET /api/admin/invitations/{invitationId}/messages`
- `PATCH /api/admin/messages/{messageId}` for moderation fields such as `isHidden`.

Authentication: OWNER.

Admin listing pagination, sort order, detail, and hide/unhide behavior are not Phase 7 public-contract blockers and are **still not locked**. Slice 8D0 must resolve the global list response, the invitation-specific list response, pagination and `pageSize` limits, sort order, returned fields, `authorName` handling, `createdAt` representation, `isHidden` visibility, the hide/unhide request and response, idempotency, the empty state, admin rendering, and plain-text safety. No schema change is expected.

Guest message content remains plain text in admin surfaces: no `dangerouslySetInnerHTML`, no Markdown interpretation.

## Admin Import Endpoints

### Validate import

`POST /api/admin/imports/guest/validate`

Authentication: OWNER plus CSRF.

Request: multipart upload with CSV or XLSX.

Response:

```json
{
  "previewId": "temporary_preview_id",
  "summary": {
    "totalRows": 100,
    "validRows": 95,
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
          "code": "POSSIBLE_DUPLICATE",
          "message": "Possible duplicate household by normalized display name."
        }
      ],
      "parsed": {
        "displayName": "John & Jane Smith Family",
        "invitees": []
      }
    }
  ]
}
```

Errors vs warnings:

- Errors block committing a row.
- Warnings require admin decision but do not automatically block.
- Possible duplicates are warnings unless a true uniqueness constraint is violated.
- Preview is not a committed `GuestImportBatch`.

### Commit import

`POST /api/admin/imports/guest/commit`

Authentication: OWNER plus CSRF.

Request:

```json
{
  "previewId": "temporary_preview_id",
  "includeRowNumbers": [2, 3, 4],
  "acknowledgedWarningRowNumbers": [2]
}
```

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

Transaction:

- All selected valid rows commit atomically.
- Invitation creation and credential-version/hash initialization occur in the same commit transaction.
- Failure rolls back the selected import.

Preview lifetime and idempotent commit semantics must be finalized before Phase 9 ships.

## Admin Check-in Endpoints

### Validate QR/check-in credential

`POST /api/admin/checkin/validate`

Authentication: OWNER plus CSRF.

This endpoint is read/validation only. It must not create `CheckinRecord`.

Request:

```json
{
  "qrPayload": "opaque_backend_credential_payload",
  "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4"
}
```

Response:

```json
{
  "status": "VALID",
  "invitation": {
    "id": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
    "displayName": "John & Jane Smith Family"
  },
  "rsvp": {
    "expectedEventAttendeeCount": 4
  },
  "event": {
    "id": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
    "name": "Holy Matrimony"
  },
  "alreadyCheckedIn": false
}
```

Validation:

- Resolve credential hash.
- Active pass exists.
- Invitation is active.
- RSVP is accepted.
- Event is eligible.
- Event is selected for attendance.
- Determine expected count from `RSVPEventSelection`.
- Check whether `CheckinRecord` already exists for Invitation + Event.

Error/status cases:

- `QR_INVALID`.
- `QR_REVOKED`.
- `INVITATION_NOT_AVAILABLE`.
- `EVENT_NOT_ALLOWED`.
- `EVENT_NOT_SELECTED`.
- `CHECKIN_ALREADY_CONFIRMED`.

### Confirm QR check-in

`POST /api/admin/checkin/confirm`

Authentication: OWNER plus CSRF.

Request:

```json
{
  "qrPayload": "opaque_backend_credential_payload",
  "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
  "attendeeCount": 4,
  "note": null
}
```

Response:

```json
{
  "checkinRecord": {
    "id": "d7c77944-633c-443b-a476-8bb16b2792de",
    "method": "QR",
    "attendeeCount": 4,
    "checkedInAt": "2026-09-17T00:00:00.000Z"
  }
}
```

Transaction:

1. Begin transaction.
2. Lock Invitation row `FOR UPDATE`.
3. Reload current RSVP/event/pass state.
4. Re-run all validation.
5. Check existing CheckinRecord for Invitation + Event.
6. Validate `attendeeCount >= 1`.
7. Validate `attendeeCount <= RSVPEventSelection.expectedAttendeeCount`.
8. Insert CheckinRecord.
9. Commit.

Concurrent confirmations:

- Unique Invitation/Event constraint is the final guard.
- Loser transaction returns `409 CHECKIN_ALREADY_CONFIRMED`.

### Manual guest lookup

`GET /api/admin/checkin/search?query=smith&eventId=7d98761a-b7fc-4a2e-8df4-69b6f22d85b4`

Authentication: OWNER.

Response: matching accepted active invitations eligible for the event with RSVP/check-in status.

### Manual check-in

`POST /api/admin/checkin/manual-confirm`

Authentication: OWNER plus CSRF.

Request:

```json
{
  "invitationId": "0975522e-edc7-445e-80f2-c9f7c88a6ff2",
  "eventId": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
  "attendeeCount": 4,
  "note": "Manual lookup"
}
```

Validation and duplicate handling match QR confirm after invitation resolution. Manual check-in must use the same backend domain service path as QR confirmation.

## Admin Reports and Export

### Report summary

`GET /api/admin/reports/summary?includeArchived=false`

Authentication: OWNER.

Returns the same categories as dashboard, with archived invitations excluded by default unless explicitly included.

### CSV export

`GET /api/admin/reports/export.csv?type=rsvp&includeArchived=false`

Authentication: OWNER.

Supported MVP export types must be finalized before implementation. Initial likely types: `invitations`, `rsvp`, `dietary`, `checkin`.

Response: `text/csv`.

XLSX export is not required for MVP.
