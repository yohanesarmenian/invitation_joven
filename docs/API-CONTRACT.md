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
| `INVITATION_NOT_AVAILABLE` | 404 | Public credential is unknown, archived, or otherwise unavailable. Do not reveal which. |
| `RSVP_VERSION_CONFLICT` | 409 | Submitted `expectedVersion` does not match current RSVP version. |
| `EVENT_NOT_ALLOWED` | 422 | Invitation is not eligible for the selected event. |
| `EVENT_NOT_SELECTED` | 422 | RSVP does not select attendance for the event. |
| `PLUS_ONE_NOT_ALLOWED` | 422 | RSVP included plus-one without permission. |
| `ADDITIONAL_CHILD_LIMIT_EXCEEDED` | 422 | Additional child quantity exceeds allowance. |
| `RSVP_ATTENDEE_INVALID` | 422 | RSVP attendee rows violate type/quantity/reference rules. |
| `QR_INVALID` | 404 or 422 | Admin scanner received invalid/non-resolvable credential; response must not leak sensitive internals. |
| `QR_REVOKED` | 422 | Admin scanner resolved a revoked/expired pass. |
| `CHECKIN_ALREADY_CONFIRMED` | 409 | Invitation already has confirmed attendance for the event. |

Public APIs must not expose credential hashes, credential versions, password/session data, admin-only fields, internal security fields, or data from other invitations.

## Public IDs

Resource IDs in request/response examples are UUID primary keys unless otherwise noted. UUIDs are acceptable for MVP because they are random and non-sequential. Credential strings, token hashes, and credential versions are never public resource identifiers.

## Public Endpoints

### Retrieve invitation

`GET /api/public/invitations/{publicCredential}`

Authentication: public credential in path.

Behavior:

- Resolve credential hash.
- Require Invitation `ACTIVE`.
- Update `first_opened_at`, `last_opened_at`, and `open_count` for valid active loads.
- Return only public invitation data.

Response:

```json
{
  "invitation": {
    "displayName": "John & Jane Smith Family",
    "greetingName": "John & Jane",
    "events": [
      {
        "id": "7d98761a-b7fc-4a2e-8df4-69b6f22d85b4",
        "slug": "holy-matrimony",
        "name": "Holy Matrimony",
        "startsAt": "2027-01-09T00:00:00.000Z",
        "venueName": "Venue",
        "address": "Address",
        "googleMapsUrl": "https://maps.google.com/..."
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
      "maxAdditionalChildren": 2
    },
    "rsvp": {
      "status": "PENDING",
      "version": 1,
      "deadlineAt": null
    }
  }
}
```

Errors:

- `404 INVITATION_NOT_AVAILABLE` for unknown credential, archived invitation, or otherwise unavailable invitation.

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
- `expectedVersion` must match current RSVP version.
- Status must be `ACCEPTED` or `DECLINED` for public submission.
- Selected events must be eligible through `InvitationEvent`.
- If event `attending = false`, `expectedAttendeeCount = 0`.
- If event `attending = true`, `expectedAttendeeCount >= 1`.
- If event `attending = true`, `expectedAttendeeCount <= total RSVPAttendee quantity`.
- Declined RSVP must not leave attending event selections active.
- `NAMED_INVITEE` requires `inviteeId`, `quantity = 1`, and Invitee must belong to the Invitation.
- Same named Invitee may appear only once.
- `PLUS_ONE` requires null invitee, `quantity = 1`, and `allowPlusOne = true`.
- At most one `PLUS_ONE` row per RSVP.
- `ADDITIONAL_CHILD` requires null invitee and quantity at least 1.
- Total `ADDITIONAL_CHILD` quantity must not exceed `maxAdditionalChildren`.
- Deadline behavior depends on unresolved RSVP cutoff question.

State transitions:

- `PENDING -> ACCEPTED`: saves RSVP/selections/attendees and creates one active CheckinPass atomically.
- `PENDING -> DECLINED`: saves declined state and ensures no active pass.
- `ACCEPTED -> ACCEPTED`: updates current RSVP state and normally retains current active pass.
- `ACCEPTED -> DECLINED`: revokes active pass atomically.
- `DECLINED -> ACCEPTED`: issues a new CheckinPass atomically.
- `DECLINED -> DECLINED`: keeps no active pass.

Errors:

- `404 INVITATION_NOT_AVAILABLE`.
- `409 RSVP_VERSION_CONFLICT`.
- `422 EVENT_NOT_ALLOWED`.
- `422 PLUS_ONE_NOT_ALLOWED`.
- `422 ADDITIONAL_CHILD_LIMIT_EXCEEDED`.
- `422 RSVP_ATTENDEE_INVALID`.
- `422 RSVP_DEADLINE_PASSED` if final rule confirms public cutoff.

Idempotency:

- Retrying after a network failure with an old `expectedVersion` may return `409 RSVP_VERSION_CONFLICT`; the client should re-read state.
- Repeating accepted RSVP at the current version must not create multiple active passes.

### Retrieve RSVP/pass state

`GET /api/public/invitations/{publicCredential}/rsvp`

Authentication: public credential.

Response includes current RSVP, version, event selections, attendees, and active pass QR payload if available.

Errors:

- `404 INVITATION_NOT_AVAILABLE`.

### Send guest message

`POST /api/public/invitations/{publicCredential}/messages`

Authentication: public credential.

Request:

```json
{
  "authorName": "John",
  "message": "Congratulations!"
}
```

Response:

```json
{
  "message": {
    "id": "46a6c61b-9c5a-4d7e-8f30-f054b7b169e1",
    "createdAt": "2026-09-17T00:00:00.000Z"
  }
}
```

Validation:

- Invitation must be active.
- Message is required.
- Length limits to be set during implementation.
- Message associates with invitation for admin visibility.

Guest message retry/idempotency policy must be decided before Phase 7 ships.

## Admin Authentication Endpoints

### Login

`POST /api/admin/auth/login`

Authentication: none.

Request:

```json
{
  "email": "owner@example.com",
  "password": "password"
}
```

Response:

```json
{
  "user": {
    "id": "6a3e6cb6-5a1a-457d-9b36-7fb7cb8ac96a",
    "email": "owner@example.com",
    "role": "OWNER"
  },
  "csrfToken": "csrf_token_for_unsafe_requests"
}
```

Side effect: sets HttpOnly admin session cookie.

Errors:

- `401 INVALID_CREDENTIALS`.
- `429 TOO_MANY_LOGIN_ATTEMPTS`.

### Current session

`GET /api/admin/auth/me`

Authentication: admin session cookie.

Response: current OWNER identity and session expiry.

### Logout

`POST /api/admin/auth/logout`

Authentication: admin session cookie plus CSRF token.

Response: `204 No Content`.

Side effect: revokes session and clears cookie.

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
- Creates or initializes RSVP pending state if implementation chooses eager creation.

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

State transitions: same RSVP/check-in pass lifecycle as public.

## Admin Message Endpoints

- `GET /api/admin/messages?page=1&pageSize=25`
- `GET /api/admin/invitations/{invitationId}/messages`
- `PATCH /api/admin/messages/{messageId}` for moderation fields such as `isHidden`.

Authentication: OWNER.

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
