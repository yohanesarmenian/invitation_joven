# Local stack and rehearsal

This is local development packaging, not a production deployment. It uses separate Docker volumes and does not point at the existing development database. One API instance is required by the in-process login throttle.

## Built application stack

Copy `ops/local-stack.env.example` to ignored `.env.local-stack`. Generate a 32-byte hex database password and a 32-byte base64url credential secret privately, for example using Node crypto. Do not use test fixture secrets for real invitations. Keep that secret stable while this database exists; changing it requires the documented invitation/pass reissue process.

```powershell
docker compose --env-file .env.local-stack -f compose.local-stack.yaml config --quiet
docker compose --env-file .env.local-stack -f compose.local-stack.yaml build
docker compose --env-file .env.local-stack -f compose.local-stack.yaml up -d
docker compose --env-file .env.local-stack -f compose.local-stack.yaml ps
```

The stack runs compiled Nest and `next start`, with internal API/database ports and loopback-only HTTPS entrypoints: `https://localhost:3000` and `https://localhost:3001`. Caddy issues a local CA certificate; install/trust the public root certificate locally before camera/session testing. Do not export its private key. This is deliberately not public DNS or an internet certificate. Production session checks, Secure/HttpOnly/host-only cookies and exact HTTPS origin validation stay enabled. Bootstrap the first OWNER using the existing operator CLI inside the API container; it accepts no default password and refuses a second bootstrap. No account is seeded automatically.

Caddy logging syntax follows its [global logging documentation](https://caddyserver.com/docs/caddyfile/options#log). Compose configuration validation alone does not prove the edge starts or that the browser trusts its local CA.

Admin API rewrites are compiled with `http://api:4000`. Changing that service hostname requires rebuilding admin-web. Public API origin is server runtime configuration. Builds do not fetch a live API; `.dockerignore` excludes all environment files, generated local artifacts, reports, logs and test output. Runtime currently retains the workspace/development dependencies to preserve pnpm links; image size/hardening remains a production optimization gate.

Migrations are a one-shot service that must complete before API starts. `/health` includes the database check. App health checks precede edge startup. Existing invitation photos remain repository assets; new OWNER event-material uploads live as bounded PostgreSQL bytea records alongside draft/current-publication JSON. No external media store is required. Never run `down -v` against a needed database. Stop with `docker compose --env-file .env.local-stack -f compose.local-stack.yaml down` to preserve volumes.

## Backup and rollback

Before an upgrade, take a PostgreSQL custom-format dump, store it privately outside the source repository, and keep the matching credential secret in a separate secret store. A database dump alone cannot reconstruct credentials with a different secret. Production retention/access schedules await the hosting decision. For local rehearsal, keep only synthetic dumps and delete them when no longer needed.

Restore a dump into a new isolated database, verify migration history, household/RSVP/check-in counts, exact operator attribution, event-material draft/publication/media bytes and the matching secret, then smoke the application against that database. Never test restore over the working development database. Application rollback means select the previous known image tag and restart apps without changing data. Migration `20261015090000_event_content` is additive; rolling back application code can leave those tables intact. Dropping them would lose uploaded content and is not an automatic rollback step. Future destructive schema migrations need a separate rollback plan. Do not blindly roll the database back after live attendance writes.

Automated synthetic rehearsal: build the API, select a migrated isolated `invitation_qa_*`, `invitation_ci` or `invitation_workflow_smoke` database, set `INVITATION_WORKFLOW_TEST=1`, then run `pnpm --filter api exec tsx scripts/local-backup-rehearsal.ts`. `PG_DUMP_BIN` / `PG_RESTORE_BIN` may point to local binaries. The script creates its own fixture, dumps/restores into a new uniquely named database on the same local server, checks persisted RSVP/pass/attendance/operator/migration facts, then removes only its own fixture, restore database and temporary dump. No credentials are printed. Never run this simultaneously with table-clearing API tests.

## Operator rehearsal

1. Each operator signs in with their own account; first login replaces the temporary password.
2. Select the correct event. Start camera explicitly or enter QR/search the household.
3. Read expected count, enter actual people arriving, then press Confirm once.
4. A lost response freezes the recovery target. Recheck exact household/event; do not blindly retry. NOT_CONFIRMED is a point-in-time read, not proof an earlier request cannot finish.
5. Check reports using explicit refresh. If connection is down, stop confirmations; there is no offline queue, walk-in creation or correction workflow.
6. Sign out and verify the camera indicator turns off. OWNER may disable/reset an account to revoke sessions.

Before venue use, test physical cameras over trusted HTTPS, network interruption, staff recovery, final event times/venues, real parking material and final copy with the owner. Local automated Chromium tests do not establish iOS/Android camera compatibility or production/venue readiness.
