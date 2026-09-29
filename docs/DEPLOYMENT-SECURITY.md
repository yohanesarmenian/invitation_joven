# Deployment Security

Operational security requirements for deploying the invitation platform. This is the
deployment-facing companion to the logging direction in `TECHNICAL-ARCHITECTURE.md` and
the Phase 12 tasks in `IMPLEMENTATION-ROADMAP.md`.

## Public Invitation Credential Logging Policy

**Raw public invitation credentials must not be retained in application, reverse-proxy,
platform, or access logs.**

The public invitation credential is bearer material: possession of the raw URL is
sufficient to retrieve one invitation. A raw credential retained in an access log is
therefore effectively another copy of the invitation link.

### Credential-bearing route families

Implemented today (source: `apps/api/src/invitations/public-invitation.controller.ts`,
`apps/invitation-web/app/i/[publicCredential]/page.tsx`):

| Route                                        | Layer          | Safe log representation                               |
| -------------------------------------------- | -------------- | ----------------------------------------------------- |
| `/i/<publicCredential>`                      | invitation-web | `/i/[REDACTED]` or omit the path                      |
| `/api/public/invitations/<publicCredential>` | api            | `/api/public/invitations/[REDACTED]` or omit the path |

The API sanitizer additionally reserves patterns for `/c/<credential>` and
`/api/public/checkin/<credential>`. Those routes are **not implemented yet**; the patterns
exist in `apps/api/src/logging/redaction.ts` so check-in and confirmation routes inherit
redaction when they ship.

### Safe log representation

- Redact the dynamic credential segment, e.g. `/i/[REDACTED]`.
- Omitting the request path entirely is also acceptable.
- Do **not** log credential hashes, credential prefixes, or any derived identifier. No
  operational need for credential-derived log material has been established. Keep the
  `[REDACTED]` constant.

If an operational need for credential-derived log material ever appears, it must be
justified and documented here first.

## Threat Model

Scope is invitation confidentiality only.

Anyone who obtains a raw public invitation credential can retrieve that invitation's
public payload: display name, greeting name, event schedule, venue, address, and the RSVP
deadline. A leaked log line is not account takeover and not authentication bypass — it is
a second copy of a link that already grants exactly that access.

Aggravating factors in the current model:

- The credential has no expiry mechanism. `Invitation.status` (`ACTIVE` / `ARCHIVED`) is
  the only invalidation lever currently implemented.
- Retrieval is not rate limited or second-factor protected; the URL is the whole secret.
- Opening a leaked link is observable: `openCount` and `lastOpenedAt` increment, which is
  a partial detection signal for operators with database access.

## Current Verified Status

Verified during Slice 5E against the real compiled API and a production-like
`next start` runtime, using synthetic credentials only.

| Layer                    | Status                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API application logging  | **Safe.** Request, success, and error logs pass through `sanitizeRequestUrl` in `apps/api/src/logging/redaction.ts`. A live compiled-runtime request produced `"url":"/api/public/invitations/[REDACTED]"`.                                                                                                              |
| Next application code    | **Safe.** No custom request logger, no `middleware.ts`, no `publicCredential` or URL logging in server retrieval, `error.tsx`, or `not-found.tsx`.                                                                                                                                                                       |
| Next production runtime  | **No raw request access log.** A production-like `next start` emitted no request access log for `/i/<credential>` requests, and the synthetic credential appeared nowhere in stdout/stderr — including the 404 path and error output, which carries a generic message, a bundle-path stack, and an opaque `digest` only. |
| Next development runtime | **Raw path visible.** Next's own dev logger prints `GET /i/<credential>`. This is framework dev output, is local and ephemeral, and is not reproduced in production mode.                                                                                                                                                |
| Reverse proxy / edge     | **Not configured in this repository.** `compose.yaml` defines PostgreSQL only; there is no Dockerfile or proxy configuration. Any deployed edge must be checked at deployment time.                                                                                                                                      |

Do not read the Next production result as a permanent guarantee. It is a verified
observation of the framework's current behavior in local production-mode testing, not a
contract, and it says nothing about a reverse proxy sitting in front of the application.

## Development Policy

Use only synthetic fixture credentials in:

- local development
- automated tests
- browser smoke tests
- CI

Never use a real wedding invitation credential outside the deployed system. The isolated
fixture database and its derived synthetic credentials already satisfy this for the real
smoke suite.

Next dev output may expose the synthetic URL locally. That is acceptable: do not add a
custom Next server or a suppression layer solely to hide dev-mode framework output. Do not
treat dev logging behavior as evidence about production.

## Deployment Requirements

The deployed reverse proxy / edge **must do exactly one of**:

1. redact the dynamic credential segment in access logs, or
2. exclude credential-bearing routes from access logging, or
3. omit the request URI/path from logs for those routes.

This is vendor-neutral on purpose. Deployment topology is not yet locked in this
repository, so no proxy-specific directive, configuration file, or product is prescribed
here. The mechanism is an operator decision; the outcome is not optional.

Also required:

- Credentials must not be moved into query parameters. The current design keeps the
  credential in the path, which the existing sanitizer patterns already cover.
- Request/response body logging, tracing, and error-reporting integrations must not store
  the credential or unnecessary invitation payload.
- Log access must be limited to authorized operators. Retention is deployment/operator
  controlled; this repository does not define a retention period.
- Operators must know that a `/i/*` log line is bearer material and should be handled with
  the same care as the invitation link itself.

## Referer

The invitation page's only outbound link is the event map link
(`apps/invitation-web/components/invitation/public-invitation-long-page.tsx`). It uses
`target="_blank"` with `rel="noopener noreferrer"`, so the credential-bearing invitation
URL is not expected to be sent as `Referer` to the map destination.

The credential is necessarily present in the browser address bar and history, because
`/i/[publicCredential]` is the public contract. That is expected credential transport, not
a logging finding.

## Credential Rotation (Incident Response Context)

There is no credential regeneration API or UI. The following is the accurate behavior of
the current source, for incident response.

The credential is derived as
`HMAC-SHA256(CREDENTIAL_SECRET, "v1" \0 namespace \0 invitationId \0 publicTokenVersion)`,
and only `SHA-256(credential)` is stored as `publicTokenHash`. Retrieval looks up the row by
`publicTokenHash` and never reads `publicTokenVersion`.

Therefore:

- Bumping `publicTokenVersion` alone is **not** sufficient. It changes the derived raw
  credential but invalidates nothing, because lookup does not consult the version.
- A valid regeneration must update the credential version **and** the stored
  `publicTokenHash` consistently, together, for the intended invitation.
- Setting `Invitation.status` to `ARCHIVED` also stops retrieval, since the lookup requires
  `ACTIVE`.

## Deployment Verification Checklist

Run before production deployment:

- [ ] Identify the actual reverse proxy / edge layer terminating the deployment.
- [ ] Inspect its access-log format and confirm how the request URI is recorded.
- [ ] Ensure `/i/*` credential segments are redacted or excluded from access logs.
- [ ] Ensure credential-bearing public API paths are redacted or excluded.
- [ ] Send one request with a **synthetic** credential through the deployed stack.
- [ ] Inspect reverse-proxy, platform, and application logs for that request.
- [ ] Confirm the synthetic raw credential is absent everywhere (zero occurrences).
- [ ] Confirm API logs still show `[REDACTED]` for the credential path.
- [ ] Confirm no request-body logging, response-body logging, or tracing captures the
      credential or sensitive invitation payload.
- [ ] Confirm production operators understand the credential is bearer material.

### Reproducible deploy-time verification

1. Create or reuse a synthetic invitation credential in an isolated fixture dataset.
2. Request `/i/<synthetic credential>` through the actual deployed public endpoint.
3. Inspect the reverse-proxy logs, platform logs, and application logs.
4. Search those logs for the exact synthetic credential string.

Expected: zero raw occurrences. Allowed: `[REDACTED]`. Then confirm the API's public
invitation path is likewise sanitized.

Never use a real guest credential for this verification.

## Out of Scope

- Credential transport redesign (moving the credential out of the path).
- Authentication or authorization redesign.
- Analytics or error-monitoring policy: no such tooling is installed.
- Browser history and address-bar exposure.
- Adding a `middleware.ts`, custom Next server, or logging dependency to this repository.
