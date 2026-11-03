# Production preparation verification

Verification date: 2026-11-03 (Asia/Jakarta).
Branch: `infra/coolify-production-deployment`.
Base HEAD: `c6f1626a6b8c0b045a5ea32266be987fa7c4a23d`.

Status: **BLOCKED for completed runtime verification**. Preparation files are
available for review; no server was deployed, no registry/source was pushed,
and nothing was staged or committed.

| Executed command                                                                                      | Result                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| docker compose --env-file ops/deploy/production.env.example -f compose.production.yaml config --quiet | PASS (placeholder configuration only)                                                       |
| pnpm deploy:test                                                                                      | PASS, 14 tests, no skips                                                                    |
| pnpm deploy:lint                                                                                      | PASS after fixing the new runner's cleanup lint finding                                     |
| Git Bash -n ops/deploy/production-init.sh ops/deploy/production-migrate.sh                            | PASS                                                                                        |
| pnpm db:validate                                                                                      | PASS                                                                                        |
| pnpm lint                                                                                             | PASS on retry; first attempt had Windows exit -1073740791 during Docker build               |
| pnpm typecheck                                                                                        | PASS, 5 tasks                                                                               |
| pnpm build                                                                                            | PASS, 5 tasks; existing TikTok Sans fallback warning                                        |
| pnpm test                                                                                             | FAIL: API global database-safety setup refused unapproved test DB; full suite not completed |
| pnpm db:status                                                                                        | FAIL: schema engine error connecting to configured invitation_5c_smoke at 127.0.0.1:5433    |
| pnpm deploy:containers                                                                                | FAIL: Docker build transport EOF during dependency install                                  |
| node ops/deploy/production-smoke.mjs                                                                  | FAIL at first image build after Compose parsing; Docker Desktop WSL unavailable             |
| git diff --check                                                                                      | PASS (tracked files); new source formatting and shell syntax checked separately             |

Docker initially reported a working Linux amd64 engine. During image build it
returned `failed to receive status: rpc error: code = Unavailable desc = error
reading from server: EOF`. Subsequent `docker info` reported `Docker Desktop is
unable to start`, `DockerDesktop/Wsl/ExecError`, exit `0xc00000fd` during WSL
bootstrap. No WSL reset, filesystem cleanup or Docker data reset was attempted.
The existing runner failed before allocating any QA containers. The new runner
also failed before allocating QA resources. Private diagnostics are in ignored
`.local-daily`; they must not be committed or published.

Pending on a working builder: three linux/amd64 image builds, production-init
role grants, migration execution, live internal network/health/proxy checks,
dump/restore smoke, then full repository tests against an isolated local QA DB
with `INVITATION_DATABASE_TESTS=1`. Never point tests at a production database.
Do not treat historical container smoke results as verification of this patch.

Pending remotely: registry authentication/digests, GitHub App master access,
Coolify rendered networks/volume/profile handling, mandatory pre-deploy migration
failure behavior, DNS/TLS/cookies/CSRF, ingress log privacy, off-server backup
schedule and actual restore rehearsal. Domain names and image digests are operator
configuration inputs, not values this preparation invents. No Phase 10E/10F
readiness is certified.

Integrity: no tracked source files changed; root `compose.yaml`, Dockerfile,
schema, migrations, business routes and authentication are unchanged. All tracked
photo PNG content hashes, including the nine requested reference assets, match
HEAD. They are tracked in this current checkout, not untracked.

Changed/new inventory (all untracked): `compose.production.yaml` (expanded the
pre-existing untracked PostgreSQL-only draft), `docs/PRODUCTION-COOLIFY.md`,
`docs/PRODUCTION-VERIFICATION.md`, `ops/deploy/production.env.example`,
`ops/deploy/production-init.sh`, `ops/deploy/production-migrate.sh`,
`ops/deploy/production-compose.test.mjs`, `ops/deploy/production-smoke.mjs`.

## Verification closure, 2026-11-03

Final status: **BLOCKED**. Docker briefly responded at preflight, then the first
image build again lost its daemon connection. Registry publication and immutable
release digests also remain unprepared. This is not deployment approval.

### Current Git and runtime evidence

Branch and HEAD still match the values above. All eight untracked deployment
files were preserved. This closure additionally changes `.github/workflows/ci.yml`
to run the new production Compose smoke in the existing Linux container job.
No publish/deploy action or production secrets were added.

`docker version` initially returned Docker Engine 29.6.2, Linux amd64;
`docker info` returned WSL2 kernel 6.6.87.2, x86_64, 15.43 GiB memory;
`docker compose version` returned 5.3.1. These successful preflight responses
do not establish successful builds or startup.

`node ops/deploy/production-smoke.mjs` validated Compose, then failed in the
API image dependency install with `rpc error: code = Unavailable desc = error
reading from server: EOF`. A second isolated QA database allocation attempt
failed before container creation. Subsequent Docker calls returned
`DockerDesktop/Wsl/ExecError`, WSL bootstrap exit `0xc00000fd`. The user's
Docker Desktop dialog independently reported the same failure. Cause beyond the
reported WSL startup failure is not established. No repair/reset was attempted.

Neither closure attempt allocated QA containers or volumes. Ignored diagnostic
files are under `.local-daily/invitation-production-qa-9969fc42/` and
`.local-daily/invitation-qa-closure-2adfad74/`. An ignored local test orchestration
script `.local-daily/production-closure-tests.mjs` was prepared but could not
provision its ephemeral database. It does not change test safety or production.

### Source contract audit

Compose defines PostgreSQL plus three applications and a profile-only migration
job. Database-only internal networking and no host port publication are present;
the PostgreSQL 18 parent volume path is correct. API/web health checks come from
the existing Dockerfile, not Compose syntax alone. Memory caps, restart policies,
non-root application user, dropped application capabilities and log rotation
are configured. Runtime application/migrator URLs remain distinct; placeholders
in the example env file are not deployable credentials or valid registry digests.

`apps/invitation-web/app/i/[publicCredential]/page.tsx` binds RSVP/message
submissions and RSVP reload to `use server` actions. Corresponding helpers in
`src/server/public-rsvp.ts`, `public-guest-message.ts`, `public-invitation.ts` and
`published-venue.ts` execute on Next's server with INVITATION_API_BASE_URL.
Venue assets use the same-origin Next route
`app/i/[publicCredential]/venue-assets/[assetId]/route.ts`, which fetches internally.
Browsers never need Docker DNS for these flows.

Admin `src/auth/browser-client.ts` and check-in/staff/import/report clients use
relative API paths with same-origin credentials. `next.config.ts` rewrites
`/api/admin/:path*` to the internal API at build time. Server session retrieval
uses the internal URL and forwards the production cookie. The cookie service
sets Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain in production.
AdminSecurityGuard retains session/role/forced-change/CSRF enforcement;
AdminOriginService requires the HTTPS external admin origin. configureApp does
not enable broad CORS. No new public proxy or authentication bypass is needed.
This is STATICALLY VERIFIED; browser HTTPS behavior remains untested remotely.

The root Dockerfile uses APP as a build argument (not three named final stages),
preserves pnpm workspace links, generates Prisma, copies the full build workspace
and public assets, and runs Node/next start as node. It does not use standalone
Next output. `.dockerignore` excludes local env, dumps, generated/local output
and private source photos. Runtime packaging is inspected, not built successfully
in this closure. The new smoke now explicitly requests/asserts linux/amd64 and
checks application-versus-migrator schema CREATE privileges on a working engine.

`.github/workflows/ci.yml` builds and tests locally on Linux but does not publish
images. `.github/workflows/promote.yml` advances release refs; it does not build
or push images either. The runbook's manual external buildx commands are the only
publication procedure. **No actual registry build/publish workflow, private pull
proof, released image digest, or matched three-image release manifest exists in
this patch.** Compose accepts nonempty image strings without enforcing digest
immutability. Supply approved digests and authenticated pulls before deployment.

Database role separation is STATICALLY VERIFIED only: application has no elevated
role attributes or schema CREATE, migrator owns public schema and can create
objects; default object privileges grant application CRUD/sequence access. Broad
default table grants also cover migration metadata; tighter metadata grants are
a remaining least-privilege hardening item. The init script only runs for empty
clusters; existing data and passwords are not reset. Runtime privilege tests,
migration execution and restore were blocked before PostgreSQL startup.

Migration ordering is an operational gate: production-migrate.sh propagates
failure and invokes migrate deploy, without reset/dev/seed. Compose does not
make API depend on this profile-only job. Therefore a plain `compose up` bypasses
the migration gate; successful mandatory Coolify hook/manual gate execution must
be demonstrated before traffic. This limitation is not treated as verified safe
automatic startup. Failed migrations may leave partial migration state according
to their SQL; no automatic rollback, repair or data restore is claimed.

### Closure commands and results

| Command/gate                                                                                          | Closure result                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| docker version / docker info                                                                          | PASS initially, later runtime unavailable as described                                |
| docker compose version                                                                                | PASS, 5.3.1                                                                           |
| docker compose --env-file ops/deploy/production.env.example -f compose.production.yaml config --quiet | PASS, static only                                                                     |
| pnpm deploy:test                                                                                      | PASS, 14 tests, no skips                                                              |
| pnpm deploy:lint                                                                                      | PASS                                                                                  |
| Git Bash -n production-init.sh production-migrate.sh                                                  | PASS                                                                                  |
| pnpm db:validate                                                                                      | PASS                                                                                  |
| pnpm lint / pnpm typecheck / pnpm build                                                               | PASS, 5 cached Turbo tasks each; existing font warning replayed                       |
| pnpm --filter api test                                                                                | FAIL before tests: safety guard refuses unapproved DB                                 |
| pnpm test                                                                                             | FAIL at same guard; admin 312, public 232, api-client 7 tests passed; API did not run |
| Production Compose image/startup/role/migration/restore smoke                                         | BLOCKED after first image build failed                                                |
| Real PostgreSQL integration tests                                                                     | BLOCKED: isolated DB allocation failed                                                |
| CI YAML parsing                                                                                       | PASS, new smoke step registered                                                       |
| Linux CI execution                                                                                    | NOT RUN: local changes are uncommitted/unpushed                                       |
| Registry publication/private pull, Coolify/TLS and browser production smoke                           | NOT RUN                                                                               |

The existing CI validate job already provisions ephemeral postgres:18
invitation_ci and sets the explicit database-test opt-in, migrates it, and runs
the root suite. The containers job now additionally runs production-smoke.mjs
after existing packaging checks. It builds sequentially, uses synthetic secrets
and a private isolated QA volume, verifies roles/health/proxy/dump/restore and
cleans only the owned QA project. Root permissions remain contents:read, and
no registry token, production secret, publish or deploy step was introduced.
These checks require the workflow and all referenced untracked files in the same
reviewed/pushed commit. No CI result can be claimed while they remain local.

Production remains blocked by runtime verification, registry release preparation,
mandatory migration-gate proof, and live TLS/backup/restore/log-privacy checks.
The existing P2 check-in abuse-control decision and Phase 10E/10F acceptance remain
outside verified readiness. No unrelated app source, schema, migration, local
Compose, authentication or reference-asset changes were made.
