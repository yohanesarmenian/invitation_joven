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

## Resolved by Phase 8 Slice 8B0

Admin authentication and security contract decisions. These are now authoritative; do not re-litigate them during Phase 8 implementation. Documentation lives in `TECHNICAL-ARCHITECTURE.md` ("Admin Authentication Architecture"), `API-CONTRACT.md` ("Admin Authentication Endpoints", "Admin CSRF and origin doctrine"), and `DATABASE-SCHEMA.md` (`AdminUser`, `AdminSession`).

- **D1 — Production admin/API topology and cookie contract** — Decision: the MVP administration surface is **same-origin in the browser** (`https://<admin-host>/` plus `https://<admin-host>/api/**`). The public invitation site may live on another origin; the admin cookie is host-only and is never scoped to a shared parent domain. No cross-origin credentialed CORS for the MVP, no `Access-Control-Allow-Origin: *`, and no browser `credentials: "include"` across origins. Nest may run internally on another port/container behind a reverse proxy or development proxy. Production cookie: `__Host-admin_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, `Domain` omitted, lifetime matching the session absolute expiration. Development/isolated-test only: `admin_session`, `HttpOnly`, `Secure=false`, `SameSite=Strict`, `Path=/`, no `Domain`; production must refuse to issue the insecure development configuration. Admin authentication requires HTTPS. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: this closes the previously open "Final admin auth deployment topology" question.
- **D2 — First OWNER bootstrap** — Decision: first-OWNER creation is **operator-only** through a CLI, conceptually `pnpm --filter api admin:bootstrap-owner`, reading `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` from the runtime environment. There is **no** network bootstrap endpoint, no `/setup`, `/register`, or `/bootstrap` route, and no public admin registration. The values must never be committed, written to files by the command, logged, included in exception text, or persisted in plaintext. The command validates, normalizes the email, hashes with the locked Argon2id parameters, enters an atomic database critical section, verifies `admin_users` is empty, creates exactly one `ACTIVE` OWNER, and exits. If **any** `AdminUser` exists, it refuses and must not update the existing account, reset its password, create a second OWNER, or silently succeed. No default email, no default password, no hard-coded credentials. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: this closes the previously open "First admin OWNER bootstrap" question. **No schema change is required.**
- **D12 — Bootstrap concurrency and OWNER count doctrine** — Decision: the empty-table check and OWNER creation are concurrency-safe via a PostgreSQL transaction-scoped serialization mechanism (a transaction advisory lock or equivalent). Two simultaneous bootstrap commands produce exactly one successful creation and one safe refusal; a bare `SELECT count(*)` then `INSERT` is insufficient. The supported MVP deployment has **one effective OWNER**; the schema may structurally permit multiple rows, but Phase 8 adds no workflow to create additional OWNERs, no admin-user creation UI, no role management, and no `ADMIN`/`EDITOR`/`VIEWER` roles. **No database singleton constraint is added.** Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: closes the bootstrap-race and OWNER-invariant gaps together; no migration.
- **D3 — Admin login identity and password policy** — Decision: the login identifier is `email`, normalized by trimming outer whitespace then lowercasing, maximum 254 characters, syntactically valid; every supported `AdminUser` writer uses the same normalization. Password policy for the MVP without MFA: minimum **15** Unicode code points, maximum **128** Unicode code points, **not trimmed**, whitespace valid, Unicode allowed, no mandatory character-class rules, no silent truncation. The bootstrap password obeys the same policy. Hashing is **Argon2id** via **`@node-rs/argon2`** with `memoryCost = 19456` KiB, `timeCost = 2`, `parallelism = 1`, and a library-generated random salt; only the encoded hash is persisted. `bcrypt`, `bcryptjs`, SHA-256, HMAC, and PBKDF2 are not used for password storage. No pepper is required. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: the algorithm was already documented; the dependency, parameters, policy, and normalization are now locked. Phase 8 adds no password strength library, breached-password lookup, email reset, password-change UI, or MFA.
- **D4 — Session token, lifetime, activity, and rotation** — Decision: opaque random sessions, **not JWT**. Each login uses **32 cryptographically secure random bytes** from Node cryptographic randomness, encoded as unpadded Base64URL (conceptually 43 characters); a new token is created on every successful login and a client-supplied session identifier is never accepted. Only `SHA-256(sessionToken)` is persisted, in `AdminSession.sessionTokenHash`; the raw token exists only transiently and in the `HttpOnly` cookie. Absolute lifetime **12 hours** from login, fixed at `expiresAt` and never extended; idle timeout **30 minutes** evaluated against `lastSeenAt` when present, otherwise `createdAt`. A session is valid only when the `AdminUser` is `ACTIVE`, `revokedAt IS NULL`, `expiresAt > now`, and the idle window has not elapsed. `lastSeenAt` is written only when at least approximately 5 minutes have elapsed since the stored activity timestamp, never on every request. **No mid-session token rotation**, and expired sessions are never reactivated. Expired/revoked rows are immediately unusable while present; bounded opportunistic cleanup may delete rows older than a recommended **7 days** past expiry or revocation, with no cron, scheduler dependency, or background worker added for it. `userAgent` and `ipAddress` stay `null` in the MVP — no proxy-trust configuration, fingerprinting, geolocation logic, or PII retention is introduced merely because the nullable columns exist. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: closes the session-lifetime, idle-timeout, rotation, cleanup, and telemetry gaps; no schema change.
- **D5 — CSRF model and origin protection** — Decision: every authenticated unsafe admin operation (`POST`, `PUT`, `PATCH`, `DELETE`) requires the `X-CSRF-Token` header, with the single exception of `POST /api/admin/auth/login`. `GET`/`HEAD`/`OPTIONS` must not mutate state and require no token; logout remains CSRF-protected. One deterministic CSRF token is bound to each `AdminSession`: `HMAC-SHA256(key = raw session token bytes, message = "admin-csrf-v1")`, encoded as unpadded Base64URL, with only `SHA-256(csrfToken)` persisted in `AdminSession.csrfTokenHash`; comparison is timing-safe. Because the token is derivable from the raw session token, the API re-derives it at session bootstrap without persisting the raw token. A successful login **and** `GET /api/admin/auth/me` both return the raw token, which is the recovery path after a refresh or a new server render; the token lasts only for that session's lifetime. No double-submit cookie, no CSRF token in a URL, no CSRF token in `localStorage`/`sessionStorage`. Defense in depth: all browser unsafe admin requests, **including login**, must pass exact `ADMIN_ORIGIN` validation — `Origin` exact-match when present, otherwise `Referer` origin exact-match, otherwise reject; no substring or suffix matching. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: the previously unspecified CSRF mechanism is now locked; broad CORS is explicitly not the answer.
- **D6 — Auth error contract and response shapes** — Decision: `400 VALIDATION_ERROR` for malformed auth bodies; `401 INVALID_CREDENTIALS` for login failure covering unknown email, wrong password, and `DISABLED` accounts indistinguishably; `429 TOO_MANY_LOGIN_ATTEMPTS` when the login throttle rejects; `401 UNAUTHENTICATED` for missing cookie, malformed token, unknown session, expired session, idle-expired session, revoked session, and a session whose `AdminUser` is `DISABLED`; `403 FORBIDDEN` reserved for an authenticated session without the required role (normally unreachable while `OWNER` is the only role); `403 CSRF_INVALID` for missing, invalid, or session-mismatched CSRF tokens and for failed admin-origin validation, without disclosing which check failed. **No public `SESSION_EXPIRED` code** — one generic `UNAUTHENTICATED` keeps the admin client to a single state. Login returns `200` with `{ user: { id, email, role }, session: { expiresAt }, csrfToken }`, updates `AdminUser.lastLoginAt`, and creates the session; the raw session token is never in the body. `GET /api/admin/auth/me` returns the same shape and never returns a session id, session token, `sessionTokenHash`, `csrfTokenHash`, `passwordHash`, `ipAddress`, or `userAgent`. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: closes the error-code and `me`-shape gaps that blocked admin-web.
- **D7 — Login throttling and enumeration safety** — Decision: the API implements a small **in-process** login limiter — per normalized email, 10 failed attempts per 15 minutes; process-wide, 100 failed attempts per 15 minutes; unknown emails participate in the same per-email limiter; a successful login clears the email's bucket; on threshold, `429 TOO_MANY_LOGIN_ATTEMPTS` without indicating whether the account exists. No Redis, no database attempt counter, no lockout column, no CAPTCHA, and no new rate-limit infrastructure. Limiter state is intentionally ephemeral, resets on process restart, and is not an account status in `AdminUser`. Unknown email, wrong password, and `DISABLED` all produce the same `401 INVALID_CREDENTIALS`; where needed to avoid materially distinguishable password-verification timing, an application-owned dummy Argon2id hash is used on the no-user path. No schema change and no migration. This is acceptable **only** for a single-API-instance deployment; before horizontal scaling, move throttling to a shared edge or store mechanism. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: this deliberately does **not** carry Phase 7's accepted no-rate-limit posture into admin password login.
- **D8 — Admin Guest Message ownership** — Decision: admin guest-message visibility and moderation **is owned by Phase 8**, resolving the roadmap conflict between the ownership sentence and the Phase 8 task list. It is **not** part of the auth-foundation slices 8B and 8C and requires its own admin-domain contract lock (Slice 8D0) before implementation. Phase 8 is therefore not complete once auth and the admin shell ship. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: the ownership sentence in `IMPLEMENTATION-ROADMAP.md` is now consistent with the slice plan. Listing pagination, sort order, detail, field selection, `authorName` handling, and hide/unhide request/response semantics remain open and move to 8D0. No schema change is expected.
- **D9 — Authorization doctrine and admin-web integration** — Decision: the **backend** is the authoritative security boundary; admin-web route protection is UX and defense in depth. Every `/api/admin/**` operation except login independently enforces a valid session, OWNER authorization where required, and CSRF plus origin validation for unsafe methods; client route state, hidden UI, a Next layout, or browser-side role data are never treated as authorization. admin-web uses **server-side session bootstrap** for protected layouts, calling `GET /api/admin/auth/me` before rendering and redirecting unauthenticated visitors to `/login`; **no Next `middleware.ts` is required for the MVP**. admin-web declares `@wedding-invitation/api-client` as a proper workspace dependency and does not introduce new `../../packages/api-client/src/**` relative-source imports. Browser-facing admin requests use the same-origin `/api` surface; server-side admin-web requests may use an internal API base URL but must forward only the required session cookie and must not forward arbitrary browser headers. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: closes the route-protection-mechanism and API-client-integration gaps. Exact guard and decorator class names remain an implementation choice, not a contract.
- **D10 — Multiple sessions** — Decision: multiple simultaneous sessions per OWNER are **allowed**. A successful login does not revoke other valid sessions. There is no one-session-per-OWNER constraint, no revoke-other-sessions-on-login behaviour, and no "sign out everywhere" operation in the Phase 8 auth foundation. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: the existing schema already supports this; no change.
- **D11 — Session expiry UX** — Decision: when `/me` or any protected admin API call returns `401 UNAUTHENTICATED`, admin-web returns the user to `/login` with one concise generic state — "Your admin session has ended. Please sign in again." — without distinguishing expired, revoked, disabled, or missing sessions. Sensitive form drafts are **not** persisted to browser storage merely to survive session expiry. After a successful login, navigate to the admin dashboard; there is no re-auth modal in the MVP. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: closes the session-expiry UX gap. The concrete login-screen visual design remains open for Slice 8C.
- **D13 — Logout scope** — Decision: `POST /api/admin/auth/logout` revokes the **current session only** — it sets `revokedAt` on the current `AdminSession`, clears the current cookie using the same name, path, and environment configuration used at login, and returns `204`. Other OWNER sessions are unaffected. A future "logout everywhere" capability is outside the Phase 8 auth foundation. Date/phase: 2026-09-30, Phase 8 Slice 8B0. Consequence: closes the logout-scope ambiguity in the API contract.

Auth-foundation implementation blockers D1-D13 are now **resolved**. Later admin-management questions — including the admin-management surface itself, Guest Message listing/moderation details, and invitation-link regeneration retry/idempotency — are carried forward to **Slice 8D0** and are not auth blockers.

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

- Status: **RESOLVED in Phase 8 Slice 8B0.** The MVP administration surface is same-origin in the browser; the admin cookie is host-only; no cross-origin credentialed CORS is used. See "Resolved by Phase 8 Slice 8B0" (D1) above.
- Historical context: cookie attributes, CSRF issuance/recovery, allowed credentialed origins, logout cookie clearing, and expired-session cleanup all depended on this topology.

### First admin OWNER bootstrap

- Status: **RESOLVED in Phase 8 Slice 8B0.** First-OWNER creation is operator-only through a CLI reading `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`, gated on an empty `admin_users` table inside an atomic critical section. There is no network bootstrap endpoint and no public admin registration. See "Resolved by Phase 8 Slice 8B0" (D2 and D12) above.
- Historical context: the repository previously had no supported first-admin bootstrap mechanism, no seed script, no user-creation endpoint or CLI, and no password-hashing dependency, so `AdminUser.passwordHash` had no writer and a deployed environment could not create its first OWNER without direct database manipulation.

### Admin-management contract (Phase 8 Slice 8D0)

- Question: the full admin-management surface still needs its own contract lock: dashboard metrics, invitation list/detail/create/edit/archive, invitee management, `InvitationEvent` eligibility management, RSVP overview/detail/override, Guest Message listing and moderation, and invitation-link regeneration retry/idempotency.
- Why it matters: these are admin-domain semantics, not auth semantics. The auth foundation deliberately does not settle them.
- Impacted components/documents: API Contract, Technical Architecture, Database Schema, UI/UX Spec, admin backend and admin-web implementation.
- Blocking phase: Phase 8 Slice 8D0, before any 8D/8E implementation.
- Status: Unresolved and deliberately carried forward. These are **not** auth-foundation blockers.

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
- Blocking phase: Before the regenerate endpoint ships. **Carried explicitly into Phase 8 Slice 8D0** by Slice 8B0; deliberately not resolved by the auth contract lock.
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
