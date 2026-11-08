# Personal wedding invitation recovery

This patch improves the existing OWNER create workflow. It does not provision a wedding, create an Event, change eligibility rules, alter Prisma models/migrations, rotate credentials, or reset a database.

## Operator checks before sharing

1. Sign in using the existing OWNER. Never repeat OWNER bootstrap.
2. Open Invitations and inspect existing records before attempting a create.
3. Open Create invitation. The one existing active wedding Event is included automatically. Stop if the screen reports missing, inactive, invalid, or multiple Events. Ask the operator to inspect the existing configuration; do not seed or replace it.
4. Read the displayed Event time and venue. Confirm the actual wedding facts with the OWNER. Missing Maps configuration does not justify inventing a URL or venue.
5. Enter the main guest's name. Optionally set a household name and add other named guests. Expand optional settings only when needed.
6. Review the household, guest count and existing Event. Select Create invitation once and wait for the server-confirmed receipt.
7. Copy Link or explicitly open the WhatsApp share draft. Share only with intended guests: the URL grants access to this household invitation.

## If submission is uncertain

Do not retry the draft, create a replacement immediately, or assume failure means no database write. Use Check invitations list, inspect the household and named guests, and load the current public link from that invitation's detail page. If no row is found, allow any in-flight request to finish and have the operator verify the result before deliberately starting a separate invitation. There is no server idempotency key or name-based deduplication. Clearing browser storage, using another tab/device, or manually calling the API bypasses the per-tab guard.

If browser session storage is unavailable, creation stops before sending a POST. Enable storage for the Admin site and reload; do not disable the guard to continue.

## Review and deployment boundary

Local isolated tests and production observations must be reported separately. The running production image does not contain uncommitted local fixes. This task does not authorize publication or deployment. Review the complete modified/new-file inventory and test evidence first.

After separate deployment approval, follow the existing [Coolify runbook](PRODUCTION-COOLIFY.md). Build the changed API and Admin Web from the reviewed source, use verified immutable image references, preserve the existing database volume and invitation credential secret, and retain PostgreSQL healthy → migrate success → API healthy → web startup gates. This patch adds no migration and needs no seed, reset, or bootstrap. The exposed OWNER password must be rotated through the supported account flow before release. Event content correction is a separately approved operation on the existing record, described below. Do not run development fixtures against production.

Before public distribution, verify the deployed create receipt, Copy Link, encoded WhatsApp target, actual `/i/[publicCredential]` design, envelope opening, real Event facts, guest identity, and RSVP persistence. Check Admin and public pages at 320, 375, 412, and desktop widths. Use only an explicitly authorized controlled invitation. Do not automatically archive, delete or rotate it afterward. Missing live evidence or unconfirmed wedding content means NO-GO for public distribution, even when containers are healthy.

## Exposed OWNER password: supported rotation

Use `https://admin.heyjo.my.id/account/password` while signed in as the existing OWNER. The OWNER enters the current password and a different new password of 15–128 Unicode characters directly in the HTTPS form and submits it personally. Never place either value in chat, shell arguments, environment files, evidence, screenshots, or Git. No OWNER bootstrap, extra account, database password update, or custom rotation script is needed.

The existing `POST /api/admin/auth/change-password` validates the session, exact Origin and session CSRF, verifies the current password and hashes the replacement with `AdminPasswordService` Argon2id (`memoryCost=19456`, `timeCost=2`, `parallelism=1`). It preserves the account ID, email, OWNER role and status, clears `mustChangePassword`, and revokes other sessions. The current session remains valid: explicitly Sign out after success, then sign in with the replacement to verify fresh authentication. Record only outcome, account identity/role and request ID/status. Do not retain passwords, hashes, session cookies or CSRF tokens. A lost change-password response is reconciled by the OWNER signing in with the new value; do not blindly resubmit the old request.

Rotation is a production security prerequisite. Source review or a passing synthetic test does not prove the live password was changed. Mark rotation/fresh login PENDING until observed. Restoring an older database backup may restore the exposed password hash; re-establish the rotated credential before reopening traffic after such a restore.

## Existing Event: one-record correction only

The existing authenticated `/events` screen already supports updates; this release does not add Event management, another Event or a setup wizard. The supported mutation is `PUT /api/admin/event-management/{eventId}` with a complete replacement body and `expectedVersion`. Never use its `POST` create route, choose **New event**, or insert/update directly with SQL.

Before preparing a mutation, read `GET /api/admin/event-management` through the signed-in OWNER session. Require exactly one returned item and record its exact UUID, version, all fields and usage. This is a private operational record; do not save cookies/CSRF or a browser HAR. Preserve its ID, slug, description, display order and active status. Map only the approved name, schedule, venue, address and Maps changes onto that snapshot. Capture the rendered complete draft for OWNER review before **Save event**. Any second Event, unexpected usage, changed version, wrong database or unverified backup stops the operation.

Validation is existing `parseEvent`/`maps`: name is nonblank and at most 200 characters, venue at most 300, address at most 2000, Maps at most 2048. Start/end must be valid ISO instants with an explicit offset, and end must follow start; enter WIB in the UI, which serializes `+07:00`. Blank nullable fields become `null`. Maps accepts HTTPS without userinfo/custom port on `google.com/maps`, `www.google.com/maps`, or a nonempty `maps.app.goo.gl/` path. Do not use lookalike hosts, an arbitrary URL or a guessed location. Open the OWNER-confirmed Maps destination before approval.

The service locks that exact Event row, checks `expectedVersion` and references, and increments version atomically. An Event already used by invitations/RSVP cannot change slug or deactivate. A checked-in Event cannot change schedule. Preserve these restrictions. On 409, stop and re-read; on network uncertainty, re-read the same UUID/version/fields before any further action. No automatic retry, replacement row or credential rotation is allowed.

### Synthetic proposal for private testing

The OWNER allowed plausible synthetic testing data on 6 November 2026. The following is a **proposal, not applied production data and not verified real wedding information**. It may be exercised on the sole Event in an isolated QA database. Updating the sole production Event still requires review of the exact UUID/version, this field set and a verified pre-change backup.

| Field                                         | Proposed testing value                                         |
| --------------------------------------------- | -------------------------------------------------------------- |
| Name                                          | QA Wedding Reception — TEST ONLY                               |
| Start (WIB)                                   | 7 November 2026, 16:00 (`2026-11-07T16:00:00+07:00`)           |
| End (WIB)                                     | 7 November 2026, 18:00 (`2026-11-07T18:00:00+07:00`)           |
| Venue                                         | QA Venue — TEST ONLY                                           |
| Address                                       | Alamat sintetis untuk pengujian; bukan lokasi acara.           |
| Google Maps URL                               | Deliberately empty (`null`); map navigation remains unverified |
| ID, slug, description, displayOrder, isActive | Preserve the exact saved values                                |

Synthetic content permits private smoke testing only. It does not satisfy the final release requirement for OWNER-confirmed wedding facts or authorize distribution to real guests.

### Backup gate before any production Event change

Restrict ingress/coordinate a maintenance window so writes cannot invalidate the reviewed snapshot. Use the existing destination VPS, resource `i1ny5d0qigqbvbybbabmzo7l` and its existing PostgreSQL container. Identify the container with both Compose project and service labels; require exactly one match. If the installed resource uses another project label, inspect it in Coolify first and document the verified identity; do not loosen the filter until something matches.

The following **Linux VPS commands are a procedure, not executed by this patch**. Run as the authorized backup operator with access to `/var/backups`; no database password is included:

```sh
set -eu
umask 077
project='i1ny5d0qigqbvbybbabmzo7l'
set -- $(docker ps -q --filter "label=com.docker.compose.project=$project" \
  --filter 'label=com.docker.compose.service=postgres')
[ "$#" -eq 1 ] || { echo 'Stop: PostgreSQL identity unresolved.'; exit 1; }
postgres_container=$1
backup_dir=$(mktemp -d /var/backups/invitation-release-XXXXXXXX)
docker exec "$postgres_container" sh -eu -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$backup_dir/database.dump"
test -s "$backup_dir/database.dump"
docker exec -i "$postgres_container" pg_restore --list \
  < "$backup_dir/database.dump" > "$backup_dir/archive.list"
sha256sum "$backup_dir/database.dump" > "$backup_dir/SHA256SUMS"
```

Before the dump, verify `current_database()` against the production DB name in the private resource settings and inspect the one Event's UUID/version with read-only SQL or the OWNER API; record the review. The full dump protects affected business relationships as well as the Event. It contains private guest data and credential hashes: keep the directory mode 0700/files 0600 and outside the repository/web root. Encrypt to the established recovery public key and copy off-server using the existing backup policy. Verify the off-server checksum and restore into a **new isolated PostgreSQL 18 database**, checking schema, the same Event UUID/version, invitation/RSVP counts and grants. Archive listing alone is not a restore test. Do not mutate production until backup/restore verification and exact field approval are recorded.

After the approved OWNER **Save event**, reload saved state and require the same UUID, one Event total, version increment by one, unchanged slug/order/active status and matching approved fields. Existing invitation eligibility, RSVP and OWNER identity must remain. Reopen the existing controlled invitation and verify its Event card/time/Maps. If correction is needed, use another explicitly reviewed versioned update; never restore a whole database over live RSVP writes or decrement a version.

## Release source, images and Coolify plan

The verified development/default branch is `master`, not `main`. Prepare a focused `codex/p0-single-wedding-release` branch from the reviewed base; stage only the explicit source/docs/test inventory, including every new file. Exclude `.local-daily/`, screenshots/logs/traces, backups, credentials, `.env` and unrelated assets. No PR is created or merged automatically.

The existing deployed image digests cannot deliver changed source. API and Admin Web need newly built/published images. After the PR is reviewed/merged and exact master-push CI succeeds, the standard `image-release.yml` path now publishes the coordinated three-image manifest automatically. The separate production workflow requires OWNER approval, then updates only those three immutable references on the existing Coolify resource and verifies rollout. Complete the one-time safeguards in [PRODUCTION-AUTOMATION.md](PRODUCTION-AUTOMATION.md) before activation. The steps below remain an exceptional manual recovery/deployment checklist, not the normal release workflow. Do not weaken authorization or mix a partial release with old manifest values.

1. Record current immutable references and volume identity for rollback. Rotate the OWNER password and confirm fresh login. Verify backup/restore before an approved Event correction or deployment.
2. Review the immutable `linux/amd64` references from the approved release: `ghcr.io/yohanesarmenian/invitation_joven/api@sha256:<actual>`, `.../admin-web@sha256:<actual>`, `.../invitation-web@sha256:<actual>`. These are reference formats, not fabricated digests.
3. In `https://coolify.heyjo.my.id`, select the existing VPS `vps.heyjo.my.id`, existing application/resource `i1ny5d0qigqbvbybbabmzo7l`, repository `master`, Compose build pack and `/compose.production.yaml`. Confirm the currently configured live resource before any Save. Do not create/clone a resource, switch topology, or rebuild on the 4 GiB VPS.
4. Verify private GHCR **read** access on the deployment VPS. Update only `API_IMAGE`, `ADMIN_WEB_IMAGE`, `INVITATION_WEB_IMAGE` to that approved manifest. Preserve `POSTGRES_IMAGE`, all existing DB secrets/URLs, `CREDENTIAL_SECRET`, volume/project identity and runtime origins. Never render resolved secrets into logs. This patch changes no runtime secret or DB role.
5. Keep Admin origin `https://admin.heyjo.my.id`, public origin `https://invite.heyjo.my.id`, Admin internal API `http://api:4000`, invitation internal API `http://api:4000`. Public service targets remain Admin 3001 and invitation 3000 behind the **existing** HTTPS/Cloudflare Tunnel routing. API 4000 and PostgreSQL have no public domain or host port. Do not replace working routing with a speculative DNS/proxy configuration.
6. Inspect Coolify's rendered Compose: PostgreSQL healthy → one-shot `migrate` exit 0 using **the new API image** and existing migrator URL → API `/health` healthy → both web services. Keep `invitation_postgres_data:/var/lib/postgresql`; confirm the actual existing volume mount matches the recorded identity. Leave generic pre-deploy hooks empty; never use `--no-deps`, selective `docker start`, `down -v`, reset, db push or OWNER bootstrap. No new migration is introduced; the standard `prisma migrate deploy` gate still runs.
7. Only after explicit deployment approval, trigger the existing resource deployment once during maintenance and inspect migration/API/web logs. If the installed Coolify rendering does not enforce the gates, stop; use only the reviewed destination fallback in [PRODUCTION-COOLIFY.md](PRODUCTION-COOLIFY.md), in the exact existing generated resource context.
8. Verify new live receipt/Copy Link/WhatsApp (target only, no automatic message), rotated OWNER auth, single approved Event, actual personal invitation design, envelope, RSVP reload and 320/375/412/desktop layouts. The existing controlled invitation is `b42748af-f031-44c0-8aa8-03cfc261129a`; its bearer URL remains private. A new non-idempotent production create needs explicit controlled-test authorization and a count check. Do not delete/archive/rotate records to manufacture a clean test.
9. If application verification fails, restrict traffic and restore the **previous image references** using the same dependency gates against the preserved database. This patch has no schema change. Do not automatically restore/reset the DB or reverse migrations. Any data restore is a separate approved recovery into a new volume, followed by verification and explicit cutover.

Final public-launch verdict is **NO-GO** until rotated-credential login, real wedding details, reviewed deployed UI and every live acceptance check are evidenced. A source commit, successful local build, test data or healthy containers alone is not GO.
