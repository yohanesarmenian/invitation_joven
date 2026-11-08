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

### Controlled image release

The approved automation is documented in [PRODUCTION-AUTOMATION.md](PRODUCTION-AUTOMATION.md): successful exact master-push CI automatically publishes images, then the separate `production` Environment requires OWNER approval before any Coolify write. Complete its one-time activation safeguards first. The legacy promotion workflow is staging-only.

After review/merge and successful `validate`, `containers`, and `ready` jobs, **Publish production images** starts automatically. For a deliberate manual publication, use GitHub Actions **Publish production images**
(`.github/workflows/image-release.yml`) > Run workflow, select **master**, and
enter the full 40-character approved `source_sha`. It must match the master SHA
selected by that dispatch, still be the current master tip, and its latest
master-push CI run must be completed/success. Tooling and build source therefore
come from the same reviewed revision containing this migration gate. The workflow
does not accept PR code or dispatches from another branch. It never calls
Coolify, changes Git refs, creates a GitHub Release or deploys a server.

Keep GitHub Environment `image-release` restricted to master. Production approval is enforced separately in Environment `production`, with required OWNER review and no administrator bypass. Protect master and review workflow/Dockerfile changes. YAML alone does not configure these rules: the automation validates the required reviewer/branch restrictions and this run's recorded approval before production writes. See the automation runbook for the verified configuration and remaining one-time UI steps.

The verification job has contents:read/actions:read. Only the protected publish
job receives contents:read/packages:write and uses its short-lived GITHUB_TOKEN.
External actions are pinned to full commit SHAs. Publication is serialized,
uses GitHub-hosted Linux runners and builds three APP variants sequentially
for linux/amd64, with the existing pnpm lockfile/Prisma generation/non-root
runtime. No production secrets, SSH keys or database access are used.

Image names are `ghcr.io/<lowercase-owner>/<lowercase-repository>/api`,
`.../admin-web`, `.../invitation-web`. Tags are unique
`<source-sha>-<run-id>-<run-attempt>` receipts for discovery only. Deployment uses
the registry digests returned by the successful build/push actions, never latest
or those mutable discovery tags. Existing packages must grant this repository
Actions write access; initial packages should remain private and linked to the
source repository via OCI source labels.

Download `production-images-<run-id>-<run-attempt>` from that successful run.
It contains `release.json` and `SHA256SUMS`. In the extracted directory:

```sh
sha256sum -c SHA256SUMS
```

Verify the artifact's GitHub run/repository, successful conclusion, approved
sourceSha, workflowSha, ciRunId and all three images before use. The checksum
detects corruption; it is not an independent signature or proof of trust.
GitHub's authenticated artifact/run record and BuildKit provenance supply the
release origin context. Archive the receipt and Actions artifact digest outside
the 90-day artifact retention period. The manifest includes each image name,
actual registry digest, complete immutable reference and linux/amd64 platform.
Copy the three `images.*.reference` strings together into API_IMAGE,
ADMIN_WEB_IMAGE and INVITATION_WEB_IMAGE in Coolify. Never mix runs or invent
digests. A partly failed publication can leave uploaded images: without all
three digests and a successful complete run it is NOT a deployable release.

Admin's internal rewrite target is baked into its build; keep service `api`
and port 4000. The local review does not publish images or a release manifest.

### Private pulls on the destination

Use a dedicated deploy identity with package **read** access to all three
private packages and a PAT **classic**, scoped only `read:packages` (no
write:packages/delete:packages; authorize organization SSO if required). The
identity must itself have package access. Git source GitHub App access does not
grant private GHCR pull access. Do not put a long-lived PAT in this workflow.
Configure the destination's Coolify-supported registry authentication, or use
`docker login` as the same destination user/Docker credential context Coolify
uses. Authenticate on the VPS, not only the separate control plane:

```sh
# GHCR_READ_TOKEN comes from a private secret input, never shell history or Git.
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
unset GHCR_READ_TOKEN
```

Prefer an OS credential helper; otherwise restrict Docker's auth config to the
deploy user (mode 0600; base64 credentials are not encryption). Never print it.
Test pulling each exact approved manifest reference in that same context before
Deploy, inspect linux/amd64 and OCI revision against sourceSha, and record only
identifiers/status. Rotate/revoke the token independently of runtime secrets.
No live credential was configured or pull performed in this local review.

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

Migration is a one-shot Compose service (no profile, restart=no), using the
**same API_IMAGE digest** and only MIGRATION_DATABASE_URL. API has
`depends_on.migrate.condition: service_completed_successfully`; both webs depend
on healthy API. Thus ordinary `docker compose up -d` waits for migration exit 0
before starting the new API and then webs. A changed API digest recreates the
migration container. Compose also reruns an exited job on a subsequent up; do
not rely on cached exit status as an operator approval. Never use --no-deps,
`docker start`, selective application restart or a custom startup that bypasses
the dependency graph. No operator shell inside API receives migrator credentials.

`ops/deploy/migrate.mjs` uses a dedicated invitation_migrator connection to the
target database and a session advisory lock with keys (1783901285,1). A competing
gate fails immediately rather than executing migration concurrently. The lock
is held across `prisma migrate deploy` and released on connection/container
termination. Prisma's own migration lock remains enabled. Interrupted/failed
children or lost lock connections fail the gate. Detailed SQL/connection errors
are omitted from shared logs; inspect `_prisma_migrations` privately on failure.
Only the migrator owns public schema; the runtime invitation_app role cannot DDL.
The gate revokes invitation_app access to `_prisma_migrations` before existing
history is used and after the first successful deploy. Bootstrap default CRUD
grants still cover business tables, while runtime cannot forge migration status.

Coolify's Compose path invokes `docker compose ... up -d`. Its general
pre-deployment command executes in an **existing container**, can be skipped
on first deployment, and is not a host shell. Leave that hook empty; do not put
the host Docker wrapper there. This gate is in the Compose dependency graph,
not the hook. Coolify may report a completed one-shot job as exited; judge its
exit code and graph, not an assumed permanently healthy migration service.

Before production, inspect the **installed Coolify version's rendered Compose**
on staging: preserve no-profile migrate, command, restart=no, required secrets,
API completed-success dependency, healthy web dependency, private DB network and
stable volume/project identity. Rehearse migration failure in an isolated staging
resource: Deploy must fail and no new app container may start. Local Docker
proof does not prove that particular parser/version/proxy. If normalization
drops the dependency or cannot support the job, block Coolify Deploy and keep
ingress closed; use this controlled destination procedure in the **exact**
generated resource project/env/file context (do not create a second project):

```sh
# Execute in one reviewed private destination shell; serialize resource operations.
# These are examples; substitute the resource's real paths/name, never guess them.
set -eu
docker compose -p RESOURCE_PROJECT --env-file PRIVATE_ENV_FILE -f RENDERED_COMPOSE_FILE pull
sh ops/deploy/production-migrate.sh -p RESOURCE_PROJECT --env-file PRIVATE_ENV_FILE -f RENDERED_COMPOSE_FILE
docker compose -p RESOURCE_PROJECT --env-file PRIVATE_ENV_FILE -f RENDERED_COMPOSE_FILE up -d --wait api admin-web invitation-web
```

The fallback shell stops before up if migration fails. It is an operational
procedure, not a technical restriction on a privileged operator clicking Deploy
elsewhere. Do not claim automatic Coolify enforcement in that fallback mode.
Allow only one resource operation at a time; the DB lock serializes migrations,
not an entire multi-service rollout. Do not run parallel deployments.

On any migration failure: keep ingress closed/maintenance in place, do not start
new images, retain logs and migration history privately and alert the operator.
Never auto-reset, db push, migrate dev, resolve or restore over the current DB.
Failed SQL can leave partial changes. A DBA-reviewed forward repair or a restore
into a separate volume is required; take another backup before intervention.

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

Before live approval: validate private pulls, Coolify normalization/dependency failure
behavior, volume persistence across redeploy, TLS/cookies/CSRF, off-server backup
and restore rehearsal. Proxy/CDN/APM logs must redact or omit credential-bearing
`/i/*` and public API paths and sensitive request bodies before real invitations
are sent. Local tests cannot prove the remote control plane, firewall or logs.
The existing pre-production P2 check-in abuse-control policy gap still needs an
operational decision; do not invent numeric limits in this preparation.

Sources: [Coolify Compose configuration](https://coolify.io/docs/applications/configuration/general),
[Coolify domains](https://coolify.io/docs/core/networking/domains),
[official PostgreSQL image](https://hub.docker.com/_/postgres),
[Compose dependency conditions](https://docs.docker.com/compose/how-tos/startup-order/),
[Coolify deployment implementation (version must be checked on staging)](https://github.com/coollabsio/coolify/blob/v4.x/app/Jobs/ApplicationDeploymentJob.php),
[GHCR authentication and digests](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Local checks: `pnpm deploy:test`, `pnpm deploy:lint`, and
`node ops/deploy/production-smoke.mjs` (requires Docker and substantial builder
memory). The last command builds three images sequentially, uses an isolated QA
project/volume with synthetic secrets and no host ports, verifies role grants,
real failed SQL blocking startup, competing migration lock refusal, successful
migration, health and admin proxy, then exercises custom-format dump/restore.
It removes only its own QA containers/volume. It is not a production restore.
