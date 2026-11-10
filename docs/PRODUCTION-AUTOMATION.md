# Approved GitHub Actions → Coolify releases

Normal delivery is now **merge to master → CI succeeds → three GHCR images publish → OWNER reviews the production deployment → Coolify receives the matching immutable image trio → deployment, migration and health verification**. Normal releases require no manual digest edits. This changes deployment tooling only; it does not change application code, database models, volumes, secrets or routing.

## Trust and approval boundaries

- `ci.yml` remains the source of CI authority. Publication requires the latest exact master-push run and its real `validate`, `containers`, and `ready` jobs, all completed successfully. A successful PR run, fork run, skipped job, failed run or old master SHA cannot authorize publication.
- `image-release.yml` automatically receives completed CI runs. Its verifier binds the CI event, repository, workflow path, run ID and source SHA to GitHub API evidence. Manual publication remains available for the current verified master SHA. Tooling and image source must have the same revision. Existing action commit pins, `image-release` environment and least-privilege package publisher remain.
- The publisher verifies each actual registry digest, linux/amd64 platform, source revision, repository label, non-root user, healthcheck and production entrypoint before uploading the coordinated release receipt. Partial publication is not deployable.
- `production-deploy.yml` receives successful publisher runs. Its read-only `prepare` job checks the authenticated publisher/artifact record, ZIP SHA-256, `SHA256SUMS`, full manifest provenance, current master/CI and image registry/runtime metadata. It has no Coolify token.
- The mutation job uses **GitHub Environment `production`** and a single resource-specific concurrency group with cancellation disabled. Environment secrets are released only after the native review gate. Code independently checks the environment's required OWNER reviewer, master-only branch policy and this workflow run's recorded OWNER approval before planning, before changing image values and before requesting deployment. A missing/deleted rule, wrong reviewer, non-master run or unrecorded approval fails closed.
- Fresh production workflow runs only: `run_attempt=1`. Do not use **Re-run jobs** for deployment recovery; it could reuse an old approval or lose context. After reconciling state, use a new manual dispatch with the exact successful publisher run ID, which receives a new production review.
- Legacy `promote.yml`/`promote.mjs` is staging-only. It cannot move a production source ref as an alternative deployment path.

Repository administrators can change workflows, secrets and protection rules. The workflow does not claim to constrain a malicious repository administrator or a human using Coolify directly. Keep workflow changes reviewed, keep the Coolify token environment-scoped, disable native admin bypass, and coordinate other production writers. There is no automatic approval API call.

## Read-only prepare diagnostics

Preparation emits JSON with fixed local stage identifiers and `STARTED`,
`SUCCEEDED`, or `FAILED` status. A failure also records its code in the Actions
summary, without the underlying exception, URL, credentials or API body:

- `WORKFLOW_IDENTITY_FAILED`: trusted workflow context or publisher trigger.
- `RELEASE_AUTHORITY_FAILED`: publisher identity, current master or successful CI.
- `ARTIFACT_VALIDATION_FAILED`: artifact identity/download, ZIP digest, entries or manifest.
- `REGISTRY_VERIFICATION_FAILED`: immutable registry images and runtime metadata.
- `PRODUCTION_PROTECTION_FAILED`: GitHub protection reads or OWNER/master policy.
- `PREPARE_OUTPUT_FAILED`: writing the verified preparation outputs/summary.

A stage code identifies the failed validation, not necessarily its underlying
cause. An unavailable GitHub read must still fail closed even when an independent
read shows correct environment settings. Use authenticated read-only probes to
separate transport/permission failures from policy violations; do not dump raw
responses or infer a cause from elapsed time alone.

Protection failures include a typed, sanitized diagnostic: a fixed endpoint name,
`API_HTTP_ERROR` with numeric HTTP status, `API_TRANSPORT_ERROR` with an allowlisted
transport code when available, `API_JSON_ERROR`, `MALFORMED_RESPONSE`, or
`POLICY_MISMATCH` with a fixed policy-field identifier. Exception text, causes,
response bodies, credentials and URLs remain omitted.

GitHub API reads use `Connection: close`. Synchronous registry inspection can
block Node's event loop while the remote peer expires an idle keep-alive socket;
the next protection request must not reuse that socket. This changes connection
lifetime only: no retry, longer timeout, permission expansion or skipped check.
The read-only protection PR workflow tests the same Actions/Contents/Packages
read token model before and after a controlled registry-length synchronous gap.
It has no production environment binding, Coolify credential or write operation.

Do not rerun a failed production workflow: attempt 2 is forbidden. After merging
a code correction, require fresh successful master-push CI and a successful
publisher for that new master SHA before a fresh production run. Keep the native
OWNER approval gate. A local read-only replay is not hosted CI or deployment proof.

## One-time setup — current status and exact steps

On 7 November 2026, live read-only UI inspection verified Coolify **v4.6.0**, resource `i1ny5d0qigqbvbybbabmzo7l`, VPS `vps.heyjo.my.id`, managed Compose `/compose.production.yaml`, and preserved repository mode. **Deploy on push (webhooks) was still enabled. No live settings were changed.** API tokens were not available to the development session; authenticated live API reads/writes and a real rollout have not been tested. The adapter is based on the installed version's official source and tested with isolated API fixtures. The first live plan rechecks version, schema and settings before permitting writes.

GitHub Environment `production` was created through the authorized API and read back: required reviewer `yohanesarmenian` (ID `78153807`), deployment branch policy only `master`. Self-review is intentionally allowed: this repository has one designated OWNER, who must be able to approve their own merged release. Approval is still a separate explicit action. The REST/GraphQL APIs used here do not expose the administrator-bypass control; it is **not claimed configured or verified**. No Coolify token or activation variable was configured by this implementation.

Complete these one-time UI actions before enabling releases:

1. **Coolify → existing application `i1ny5d0qigqbvbybbabmzo7l` → Advanced → Auto deploy:** select the disabled/manual setting rather than **Deploy on push (webhooks)**. Save deliberately. Do not click Redeploy. This is required: a direct push webhook would bypass the GitHub review boundary. Ensure preview auto-deploy is disabled for this production resource as well. Keep managed Compose, `/compose.production.yaml`, preserve-repository mode, the same VPS/volume, domains, Cloudflare Tunnel, and existing empty pre/post-deploy hooks. Do not alter the other resource or any tunnel configuration.
2. **Coolify → Keys & Tokens → API tokens:** create an expiring dedicated integration token in the existing resource's team. On reviewed **v4.7.3**, select `read`, `read:sensitive`, `write`, and `deploy`; do not grant `root`, `delete` or `write:sensitive`. Select resource scope **only** `i1ny5d0qigqbvbybbabmzo7l`, rather than team-wide access. Keep the complete issued token, including its numeric prefix, private. `read:sensitive` is necessary for comparing existing image values/Compose and privately reading migration logs; code never emits those sensitive responses. `write` permits the narrow env update, and `deploy` permits the one deployment request. The adapter itself has a method/path/body allowlist.
3. **GitHub repository → Settings → Environments → production:** verify required reviewer `yohanesarmenian`, selected deployment branch `master`, and **deselect “Allow administrators to bypass configured protection rules.”** Save and review the resulting setting. Do not remove required reviewers. Do not enable Prevent self-review while this OWNER is the only available reviewer.
4. In that same **production** environment, add environment secret **`COOLIFY_API_TOKEN`** directly from the private Coolify token UI. Never send it to chat, store it in the repository, put it in a URL/command, or create it as a repository-wide secret. The same environment should have **no** database passwords, OWNER password or invitation bearer URLs for this automation.
5. After the above is verified and backup/recovery readiness is confirmed, add environment variable **`PRODUCTION_DEPLOYMENT_ENABLED=true`** in **production**. Missing/false activation or a missing token blocks before Coolify access. Retain the existing VPS-side private GHCR pull identity with read access to all three packages; GitHub's short-lived publishing token is not a VPS registry credential. Keep `image-release` restricted to master; production approval belongs in `production` so ordinary image publication can remain automatic.

No ZIP download, source creation, workflow editing or normal-release digest copying is required from the user. Do not merge this PR until reviewing the code and setup. This development task does not authorize or perform a production deployment.

## Installed-version API contract

The reviewed source is official Coolify **v4.7.3**, commit [`30335d80866ff3391d899cf4ccb599b696f47b7e`](https://github.com/coollabsio/coolify/tree/30335d80866ff3391d899cf4ccb599b696f47b7e). The compatibility review compares it with the previously supported [v4.6.0 source](https://github.com/coollabsio/coolify/tree/0becfba9113063336b09860579627fd218cb3fc4) and the OWNER's intermediate [v4.7.2 installation](https://github.com/coollabsio/coolify/tree/312fcbfd89d6bb54cbaae70f6c2c13baa876d7ec). Only exact version `4.7.3` is accepted, with an optional leading `v` and surrounding whitespace. Other releases, prereleases and build suffixes fail before resource access.

On 10 November 2026, production run [42757397195](https://github.com/yohanesarmenian/invitation_joven/actions/runs/42757397195) passed preparation and failed at the plan's version guard while pinned to 4.6.0. Its image-update and deployment-request steps were skipped. During this review, the OWNER upgraded Coolify from 4.7.2 to 4.7.3. The authenticated dashboard subsequently displayed 4.7.3, no available upgrade, and the existing target resource as Running. The agent performed no upgrade or configuration write.

**Live API evidence remains pending.** Dashboard authentication did not authorize `GET /api/v1/version`, which returned `Unauthenticated`; no authorized API token was available to this review. The dashboard version is supporting UI evidence. Before approving this compatibility change, use an authorized read-only API session to confirm `/version` is exactly 4.7.3 and the target's resource, storage, health and applied-hash evidence still pass the existing plan checks. Never export raw envs, logs or API responses. Public GET probes returned Admin login 200, invitation root 200 and unauthenticated Admin session 401. These probes do not establish database or personal invitation acceptance.

| Operation            | Reviewed endpoint                                                                          | Use                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Installed version    | `GET /api/v1/version`                                                                      | Exact reviewed adapter version                                                               |
| Existing application | `GET /api/v1/applications/{uuid}`                                                          | Resource/server/repository/branch/settings/Compose/domains/health                            |
| Existing envs        | `GET /api/v1/applications/{uuid}/envs`                                                     | Three immutable image values and protected configuration snapshot                            |
| Existing mounts      | `GET /api/v1/applications/{uuid}/storages`                                                 | Preserve storage identity/configuration                                                      |
| Deployment history   | `GET /api/v1/deployments/applications/{uuid}?skip=0&take=20`                               | Active-operation guard, application identity, response-loss reconciliation                   |
| Image values only    | `PATCH /api/v1/applications/{uuid}/envs/bulk`                                              | One body containing only the three existing production image keys/values, `is_preview=false` |
| Queue once           | `POST /api/v1/applications/{uuid}/start`                                                   | `{ "force": false, "instant_deploy": false }`                                                |
| Exact operation      | `GET /api/v1/deployments/{deployment_uuid}`                                                | Status, commit, application ID and applied `configuration_hash`                              |
| Migration proof      | `GET /api/v1/applications/{uuid}/logs?service_name=migrate&lines=100&show_timestamps=true` | Read stopped migration-container logs privately; emit only verified outcome                  |

The nine endpoint handler bodies above are unchanged across all three reviewed releases. Authentication still requires a bearer token and the resource-scoped abilities `read`, `read:sensitive` for logs, `write` for env updates and `deploy` for start. New server-secret redaction affects nested server credentials; the adapter uses server UUID identity and does not require those credentials. Environment shown-once locks remain enforced, and the adapter continues rejecting locked image variables. Sources include the pinned [routes](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/routes/api.php), [ApplicationsController](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Http/Controllers/Api/ApplicationsController.php), [DeployController](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Http/Controllers/Api/DeployController.php), [API ability middleware](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Http/Middleware/ApiAbility.php) and [token form](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Livewire/Forms/ApiTokenForm.php).

The 4.7.3 compatibility review also covers these deployment behaviors.

- Health aggregation can now report `running:starting` during container startup. Existing preflight rejects it and rollout polling waits for `running:healthy`. One-shot `restart: "no"` services remain excluded from aggregate health, with migration success independently verified. See the pinned [health aggregator](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Services/ContainerStatusAggregator.php) and [Compose exclusions](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Traits/CalculatesExcludedStatus.php).
- New auto-cancel settings concern webhook deployments. API starts default to no cancellation without an explicit `cancel_previous` request. The adapter's unchanged body allowlist omits that option. New MCP-origin records set `is_mcp=true` and clear `is_api`, so they cannot satisfy the existing API response-loss reconciliation filter. See the pinned [deployment queue helper](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/bootstrap/helpers/applications.php).
- Deployment snapshots remain hidden, while application `config_hash` and deployment `configuration_hash` retain the same applied SHA-256 relationship. Additional settings and metadata remain protected by the existing integrity seal. Immutable image checks, protected Compose dependencies, PostgreSQL parent-volume mount, non-atomic env readback and rollback receipts remain enforced. See the pinned [application model](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Models/Application.php), [queue model](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Models/ApplicationDeploymentQueue.php), [configuration snapshot](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Services/DeploymentConfiguration/ApplicationConfigurationSnapshot.php) and [deployment job](https://github.com/coollabsio/coolify/blob/30335d80866ff3391d899cf4ccb599b696f47b7e/app/Jobs/ApplicationDeploymentJob.php).

Focused synthetic regressions accept the reviewed 4.7.3 response shape, reject unreviewed versions before resource reads, exercise the starting-to-healthy transition, block settings drift after planning and reject MCP records during uncertain API-start reconciliation. They preserve authority checks and exactly one image update/deployment request in the isolated fixture. They do not execute a production mutation. After approved merge, require fresh master CI, a fresh publisher and a new production workflow run with recorded OWNER approval. Do not rerun run 42757397195.

The bulk endpoint saves env rows individually; **it is not atomic**. All three values and protected state are read back even after an error/lost response. Partial values stop before deployment; there is no automatic repair/rollback. Only matching complete readback can reconcile a lost update response. The deployment POST is never automatically repeated. An ambiguous response is reconciled against fresh deployment IDs in that exact application's history; ambiguous/absent evidence remains uncertain.

## What the approved job verifies

The target file `ops/deploy/production-target.json` contains only non-secret identity and public origins. Wrong UUID/server, repository, branch, domains, version, non-immutable images, active deployments, unexpected startup hooks/commands, webhook mode, raw deployment mode or missing health evidence stops the release. Core services must match the reviewed production Compose; unrelated tunnel services/settings are preserved, not rewritten.

The plan captures previous immutable references, their verified common source revision, deployment IDs and keyed integrity seals. It contains no raw env values, Compose content, database credentials or log/API responses. The plan is uploaded **before** any Coolify write. Previous source must be an ancestor of or identical to the new source; divergent/newer production cannot be overwritten. Current master/OWNER approval and all protected state are rechecked immediately before mutation and again before deployment. A protected-state change or master moving after env update yields `UPDATED_NOT_DEPLOYED`/reconciliation evidence, not a blind deployment or automatic compensation.

Only `API_IMAGE`, `ADMIN_WEB_IMAGE`, `INVITATION_WEB_IMAGE` change. No application settings, source refs, domains, Cloudflare configuration, PostgreSQL role/URL/password, `CREDENTIAL_SECRET`, OWNER, Event, invitation or volume is mutated. Database work is exclusively the existing approved image's migration gate:

**PostgreSQL healthy → migrate exit 0 → API healthy → Admin and invitation web healthy.**

A `200` from the deployment API is only queue acknowledgement. Success requires the exact deployment to finish, its approved Git commit, matching applied configuration hashes, the three approved image values still read back, protected configuration still matching, a timestamped `Prisma migrate deploy succeeded.` log from that deployment, and Coolify `running:healthy`. Reviewed Coolify v4.7.3 excludes `restart: "no"` one-shot services from aggregate running-container health; the migration is checked separately. The four running core services may not be excluded from health checks. Read-only HTTPS probes check Admin `/login`, the public root and an unauthenticated Admin API rejection. They do **not** claim real OWNER login, a personal invitation design, RSVP business acceptance or public wedding-launch approval.

Despite its OpenAPI schema, reviewed v4.7.3 deliberately hides `configuration_snapshot`/`configuration_diff` in `ApplicationDeploymentQueue`, even for `read:sensitive`. The adapter does not invent those fields in live responses. The versioned successful-deployment handler computes a hash of its full internal configuration snapshot (including image environment values), writes `DeploymentQueue.configuration_hash`, and writes the same hash to `Application.config_hash`. The plan first confirms that the installed API exposes a matching existing applied record; missing evidence blocks **before** mutation. After deployment, those exposed SHA-256 hashes must match, and a changed image trio must produce a different applied hash. Raw encrypted/decrypted snapshots are never required or exported. Registry metadata, pre/post env readback and protected-state seals supply the remaining evidence under the exclusive-writer operating rule. Tests intentionally omit the hidden snapshots. If the installed API does not provide matching applied-hash evidence, stop and reconcile through supported Coolify operations; never fabricate or manually overwrite hash fields.

The Coolify start endpoint has no reviewed per-request Git-commit pin for a Compose resource tracking master. Therefore the workflow rechecks master before each write and verifies the actual cloned commit and applied configuration afterward. Do not merge another change or manually edit/redeploy the resource during an approved rollout. If master changes in the remaining server-side clone window, the rollout is reported unverified and requires reconciliation; the system does not pretend an API acknowledgement proves the selected source ran. GitHub concurrency serializes this automation, not an unrelated human/API client; the fingerprint/readback guards detect such external drift but Coolify's bulk endpoint does not provide compare-and-swap.

## Reading summaries and responding to failures

The Actions prepare summary shows the verified source, CI/publisher links and artifact SHA. Native **Review deployments → Approve and deploy** is the normal OWNER action. After approval, inspect the plan/outcome artifacts (90-day retention) and final summary. Archive these non-secret receipts outside Actions retention if needed. Do not publish raw Coolify configuration or logs in issue/PR comments.

- `BLOCKED`/preflight: no configuration write was attempted. Fix the stated setup/authority issue, inspect state, then use a fresh workflow run if appropriate.
- `ENV_UPDATE_REQUESTING` without complete readback, or any partial trio: inspect the three values in the existing resource and compare against the captured previous/next references. A timed-out request may still finish. Do not deploy while values are mixed.
- `ENV_UPDATE_VERIFIED` without deployment: envs changed but deployment was deliberately withheld (for example, master/approval drift). Inspect for in-flight operations before deciding whether to restore the previous trio or approve a newer coordinated release.
- `DEPLOY_REQUESTING`/`OUTCOME_UNCERTAIN`: inspect that exact application's deployment history and the captured known IDs before doing anything. Do not blindly resend the POST. A queue response may have been lost.
- `DEPLOY_QUEUED`/failed/timeout: inspect the exact deployment UUID, migration and runtime health privately. A failed job may have changed containers; it is not proof nothing happened. The workflow does not cancel, restart or rollback automatically.
- `ALREADY_DEPLOYED`: the exact source/images, applied configuration evidence, migration and current health were read-reconciled; no second mutation was made.

After reconciliation, manual **Deploy approved production release → Run workflow → master → release_run_id** can select the successful current-master publisher. It receives a fresh approval. It is not a CI override and cannot select a stale SHA. Never change the activation flag or protection rules merely to make a failing gate green.

## Rollback without data loss

1. Stop further release approvals and coordinate a maintenance window. Preserve the failed run's plan/outcome and exact deployment UUID. Confirm no queued/in-flight operation can overwrite recovery.
2. Review the previous image trio in `production-plan-<run>-1` against the last known successful rollout. It records prior **configured** image references; if an earlier rollout was already uncertain, do not assume configuration alone proves those images were the running version.
3. Review schema compatibility and current database migration state privately. Image rollback does not reverse migrations; an incompatible application may require a reviewed forward fix instead. Keep the existing database, roles, credential secret and volume.
4. With explicit OWNER recovery approval, restore only the three reviewed previous immutable references on the **same** Coolify resource and deploy through the same complete Compose dependency graph. This exceptional rollback is manual; the normal automation deliberately rejects stale publisher SHAs. Do not use mutable tags, selective starts, `--no-deps`, `down -v`, seeds, resets or OWNER bootstrap.
5. Verify migration exit, healthy API/webs, HTTPS and the authorized guest/Admin flows. Keep data backups/off-server recovery available under the existing production runbook. Never automatically restore a database backup over live RSVP writes. Any data restore requires separate approval, an isolated restore test and explicit cutover.

## Validation and activation boundary

Local deployment tests use synthetic manifests, registry outputs, deployment records and isolated mocked API mutations; they do not contact production for writes. Actionlint, deployment lint/tests and formatting validate source. The new read-only artifact/registry validator was also exercised successfully against the previously approved `ba7dbc3…` release (publisher `42255532624`, CI `42253642001`), including actual artifact/archive checksums, three registry images and the newly configured production reviewer policy. That test used no Coolify token, no Coolify API calls, no new image publication and no deployment. It is not hosted CI or a live rollout of this feature branch. Existing container/DB/Compose gates remain in CI.

Operational activation is **BLOCKED** until the OWNER completes the token/secret, disables native push deployment, verifies no-admin-bypass and enables the environment variable. First approved live deployment remains separately unverified until the full job and live acceptance checks actually succeed. Healthy images or mocked tests do not establish public production readiness.
