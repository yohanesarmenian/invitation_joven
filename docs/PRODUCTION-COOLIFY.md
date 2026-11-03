# Production deployment on the small VPS

This is the reviewable four-service production preparation for Ubuntu 22.04
x86_64, 2 vCPU, 4 GiB RAM, 80 GB disk. It has not deployed a server. Use
`compose.production.yaml`; keep `compose.yaml` for local development.
The existing `compose.coolify.yaml` and promotion workflow describe a different
source-build/separate-database topology. Do not combine their instructions with
this topology. This resource reads the private repository's `master` branch and
pulls externally built images. Disable automatic deployment on every master push:
the image digests and migration approval must be selected together.

## Images and supply

Reuse the root multi-stage `Dockerfile`, `ops/deploy/start.sh`, and image health
check. Runtime is non-root Node 22 with compiled API or `next start`, no package
download at startup. The build contains workspace dependencies (including Prisma
CLI), so the API image doubles as the migration image. Build sequentially on an
external Linux amd64 CI/build host with sufficient memory, never this 4 GiB VPS.
The existing Dockerfile's 1536 MiB Node heap is not a total build memory limit.
No production secret belongs in a build argument or build environment.

After review/merge and successful repository CI, check out the exact approved
master SHA on that builder. Authenticate privately to GHCR (or equivalent).
For each APP `api`, `admin-web`, `invitation-web`, execute:

```sh
docker buildx build --platform linux/amd64 --build-arg APP="$APP" \
  --build-arg SOURCE_COMMIT="$RELEASE_SHA" \
  --build-arg ADMIN_API_INTERNAL_BASE_URL=http://api:4000 \
  --tag "$REGISTRY_IMAGE:$RELEASE_SHA" --push .
```

Set a different `REGISTRY_IMAGE` for each APP. Record each resulting registry
digest, source SHA, successful CI run and migration review. Deploy `@sha256:`
references, not mutable `latest` tags. These are future operator commands; this
preparation does not push images or source. Admin's internal rewrite target is
baked into its build; keep the API service name `api` and port 4000.

## Coolify settings

- Destination: deployment VPS, not the separate Coolify control-plane host.
- Source: private repository via narrowly scoped GitHub App, branch `master`.
- Build pack: Docker Compose, base directory `/`, file `/compose.production.yaml`.
  Preserve repository files so the relative `production-init.sh` bind mount
  resolves on the destination. There are no build sections to run on the VPS.
- Registry: configure authenticated private image pulls on the destination Docker
  host via Coolify's registry credentials or private `docker login`; use read-only
  package access for the deploy host. GitHub source access does not grant GHCR
  package access automatically. Keep tokens out of repository and deployment logs.
- Domains: invitation-web `https://invite.YOUR_DOMAIN:3000`, admin-web
  `https://admin.YOUR_DOMAIN:3001` (Coolify domain port selects container target).
  No domain for api, postgres or migrate. No service publishes a host port.
- Proxy/TLS: Coolify's proxy on the deployment VPS terminates HTTPS; DNS A/AAAA
  must resolve to that VPS, not the control plane. Open 80/443 for HTTPS issuance
  and traffic; restrict SSH to operators/control plane. Keep DB port 5432 closed.
- Networks: web/API use Compose default networking; API/migrate/PostgreSQL also
  share the internal `database` network. Do not attach PostgreSQL to a public or
  shared proxy network. Inspect Coolify's rendered Compose for this boundary.
- Volume: `invitation_postgres_data` -> `/var/lib/postgresql`, the official
  PostgreSQL 18 parent mount (PGDATA is versioned beneath it). Keep the Coolify
  project/resource identity stable. Never use `down -v` for a production resource.
- Memory ceilings total 3072 MiB for the four running services, leaving about
  1 GiB for OS, proxy, Docker and cache. Measure actual load/IO/OOM and disk use;
  these ceilings are initial protection, not venue-capacity evidence. Keep one
  API replica: login throttling is process-local. Rotate logs and monitor disk.

## Environment

Template: `ops/deploy/production.env.example`. Enter all real values as runtime
secrets/settings in Coolify. Never commit a filled copy or print resolved Compose
with secrets. No `NEXT_PUBLIC_*` secret is needed.

| Variable                                         | Required meaning                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| API_IMAGE, ADMIN_WEB_IMAGE, INVITATION_WEB_IMAGE | Matching approved immutable amd64 image digests                           |
| POSTGRES_IMAGE                                   | Official postgres:18, preferably reviewed immutable 18.x digest           |
| POSTGRES_DB                                      | Production database name, e.g. invitation                                 |
| POSTGRES_PASSWORD                                | Independent PostgreSQL administrator password                             |
| APP_DATABASE_PASSWORD                            | Independent restricted invitation_app password                            |
| MIGRATOR_DATABASE_PASSWORD                       | Independent invitation_migrator password                                  |
| DATABASE_URL                                     | invitation_app URL to postgres:5432, URL-encoded password and matching DB |
| MIGRATION_DATABASE_URL                           | invitation_migrator URL to same DB, supplied only to migration job        |
| CREDENTIAL_SECRET                                | Persistent canonical Base64URL encoding of 32 random bytes                |
| ADMIN_ORIGIN                                     | Exact external HTTPS admin origin, no path/trailing slash/wildcard        |
| PUBLIC_INVITATION_BASE_URL                       | Exact external HTTPS invitation origin                                    |

NODE_ENV=production, bind address, internal API URLs, ports, memory settings and
LOG_LEVEL=info are defined in Compose. Never inject QA/test flags. The bootstrap
script initializes distinct DB roles only on a new empty volume. Changing env
passwords later does not rotate persisted roles; rotate roles explicitly and
update URLs together. Existing volumes require reviewed grants/ownership before
deployment. Do not run QA SQL, seed/reset commands, `db push`, or migrate dev.

Browser admin APIs stay same-origin at `/api/admin/**`, proxied by Next to API.
Server-side admin and invitation requests use http://api:4000. Preserve Origin,
Referer and Set-Cookie through the proxy; global guard enforces exact admin
Origin/Referer plus session-bound CSRF. No cross-origin CORS is required. Check
`__Host-admin_session` is Secure, HttpOnly, host-only, Path=/ and SameSite=Strict
over real HTTPS. No test authentication bypass is configured by this stack.

## Migration gate and deployment order

Migration uses a profile, so a normal Coolify deployment does not run it as a
long-lived service. A successful explicit migration is a REQUIRED release gate,
not something health checks can infer. Configure a fail-closed pre-deployment
command in the resource's actual generated Compose working directory, with its
actual Compose project name and env file. Use Coolify's rendered file if it
renames the source; verify that command on staging before production. Logical
command with the original file is:

```sh
docker compose -f compose.production.yaml up -d --wait postgres
docker compose -f compose.production.yaml --profile migration run --rm migrate
```

Run sequentially with `set -eu`; propagate any failure and do not continue to
application deployment. Do not run these commands from a different project name
or they may target a new volume. `migrate` executes:
`node node_modules/prisma/build/index.js migrate deploy` in `/workspace/apps/api`.
Always use `run --rm` for this job so a previous exited container cannot falsely
satisfy the next release. If the installed Coolify version cannot guarantee this
pre-deploy hook/context, keep deployment manual and run the gate from the private
destination terminal before authorizing Deploy. Do not enable traffic until it
exits zero. Initial deployment has no app traffic until the gate completes.

The checked-in fail-closed wrapper is `ops/deploy/production-migrate.sh`. For
example, after substituting the actual private resource context:
`sh ops/deploy/production-migrate.sh -p RESOURCE_PROJECT --env-file PRIVATE_ENV_FILE -f RENDERED_COMPOSE_FILE`.
Configure it as the mandatory pre-deploy command and prove a failed migration
aborts deployment on staging. A normal `compose up` alone is not release approval.

For updates: maintenance/restrict ingress, take and verify backup, pull approved
images, start/check PostgreSQL, run migration gate, deploy API, wait for healthy
`/health` with database=ok, then start both webs. Inspect the rendered dependencies.
Use additive/backward-compatible migrations; Compose is not an atomic rollout.
For incompatible migrations, stop existing app containers during maintenance.
Test authenticated/unauthenticated admin behavior and synthetic invitation flow
through HTTPS before admitting real traffic. Bootstrap OWNER only via private
API terminal `node ops/deploy/bootstrap-owner.mjs` with temporary bootstrap env;
remove it afterward. Never use development OWNER credentials.

## Backup, restore and rollback

Before first traffic and before every migration, schedule a destination-side job
(root-only config, umask 077) for custom-format pg_dump. Daily is the minimum;
agree an RPO with the owner and increase frequency for RSVP/venue operations.
Example inside the resource's correct Compose context on Linux:

```sh
umask 077
docker compose -f compose.production.yaml exec -T postgres sh -eu -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_FILE"
docker compose -f compose.production.yaml exec -T postgres \
  pg_restore --list < "$BACKUP_FILE" > /dev/null
```

Check command exit codes and nonzero file size. Encrypt dumps before sending
off-server (e.g. age to an offline recovery public key), checksum encrypted files,
then upload with a dedicated write-scoped S3-compatible/offsite identity. Configure
retention (suggested 7 daily, 4 weekly, 3 monthly), deletion protection and failed
job alerts. Keep encryption private key, CREDENTIAL_SECRET and role recovery
secrets in separate protected off-server recovery storage. Do not store backups
only on the VPS or in GitHub artifacts. Avoid plaintext guest data in logs.
Dump does not include role passwords; provision roles/grants on recovery.

Restore rehearsal: provision a NEW isolated PostgreSQL 18 volume/database owned
by invitation_migrator with the same role names, restore the decrypted dump using pg_restore --exit-on-error
--no-owner --no-privileges --role=invitation_migrator with administrator connection,
then reapply application grants to existing tables/sequences (default privileges
cover only newly created objects). Verify migration history, counts, constraints,
restricted role rights, health, credential re-derivation with the matching secret,
and synthetic login/invitation/check-in flows. Record restore duration and last
recoverable timestamp. Never test restore over the live DB. Cut over connection
settings only during an approved maintenance window; retain original volume.

Rollback code by restoring the three previous image digests only if they are
compatible with the migrated schema. Do not automatically reverse migrations.
Otherwise stop traffic and restore the verified backup into a separate volume,
validate and switch over with explicit acceptance of writes lost since backup.
Keep original DB and old images for investigation. Prune unused images only after
the rollback window; monitor 80 GB disk capacity.

## Acceptance boundaries

This prepares deployment, not Phase 10E/10F acceptance. Existing source includes
scanner/staff routes; their presence/build success does not establish physical
camera support, venue readiness or completed phase sign-off. Check the merged
roadmap/progress with the owner before public use. No business behavior changed.

Before live approval: validate private pulls, Coolify normalization/hook failure
behavior, volume persistence across redeploy, TLS/cookies/CSRF, off-server backup
and restore rehearsal. Proxy/CDN/APM logs must redact or omit credential-bearing
`/i/*` and public API paths and sensitive request bodies before real invitations
are sent. Local tests cannot prove the remote control plane, firewall or logs.
The existing pre-production P2 check-in abuse-control policy gap still needs an
operational decision; do not invent numeric limits in this preparation.

Sources: [Coolify Compose configuration](https://coolify.io/docs/applications/configuration/general),
[Coolify domains](https://coolify.io/docs/core/networking/domains),
[official PostgreSQL image](https://hub.docker.com/_/postgres).

Local checks: `pnpm deploy:test`, `pnpm deploy:lint`, and
`node ops/deploy/production-smoke.mjs` (requires Docker and substantial builder
memory). The last command builds three images sequentially, uses an isolated QA
project/volume with synthetic secrets and no host ports, verifies role grants,
migrations, health and admin proxy, then exercises custom-format dump/restore.
It removes only its own QA containers/volume. It is not a production restore.
