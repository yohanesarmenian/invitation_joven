# Template implementation, 16 October 2026

Workflow backup/restore daily manual kini tersedia: exported snapshot, signed manifest + matching recovery config, verifikasi seluruh tabel, restore terpisah dan cleanup ownership. Lihat [runbook](DAILY-BACKUP-RESTORE.md) dan [verifikasi](DAILY-BACKUP-VERIFICATION.md). Desain, kontrak API dan schema tidak diubah oleh slice tooling ini.

Pengelolaan Acara lokal kini memiliki editor OWNER, version conflict, perlindungan reference/check-in dan sinkronisasi tanggal/countdown/calendar. Migration Event version sudah diterapkan ke local daily terpisah. Lihat [pemakaian/kontrak](EVENT-MANAGEMENT.md) dan [bukti verifikasi](EVENT-MANAGEMENT-VERIFICATION.md); catatan migrasi/coverage lama di bawah adalah riwayat per slice.

> Acuan final owner, 16 Oktober 2026: tampilan mengikuti Figma persis; REA hanya menjadi acuan animasi/interaksi. Runtime memakai figma-invitation-theme.css dan ekspor Figma terbaru. Lihat [pemetaan dan batas fidelity](design/jo-venta/FIGMA-FIDELITY.md). Keputusan prototype/susunan foto sebelumnya di bawah merupakan riwayat dan telah superseded.

The owner-selected Figma composition and original photography are integrated into invitation-web, including owner-confirmed parental names/titles, independent opening/reveal motion, reduced motion, image fallback and full-image gallery. See the [V01–V22 execution ledger, checks and replacement runbook](design/jo-venta/IMPLEMENTATION.md). Local implementation is available; final venue/footer copy, physical-device QA and deployment remain explicit open gates. No commit, staging or development DB migration was performed. Earlier phase records below are preserved as historical evidence.

# Local completion work, 15 October 2026

The owner authorized execution of the gap backlog end to end, then clarified that all work targets local development in this repository. No hosting/domain, parking material, or final rundown exists yet. Do not invent venue instructions or claim production readiness. Do not commit without a separate request.

## Baseline (G00)

Branch: `fix/checkin-manual-status-reconciliation`. Pre-existing edits cover the manual-status backend, its integration/OpenAPI tests, API contract/roadmap and generated client. Nine untracked reference PNGs are also pre-existing. Preserve these changes and all original invitation assets.

Typecheck and lint passed before implementation. OpenAPI and client regeneration succeeded. Destructive integration tests use a separate PostgreSQL QA database, never the configured development database. Current local QA uses PostgreSQL 16; CI targets PostgreSQL 18, so the local result does not establish version-18 validation.

## Execution ledger

| Tasks | Status                                             | Evidence / remaining gate                                                                                                                                                                                                                   |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G00   | Passed baseline                                    | Typecheck/lint/contract generation and all unit/integration suites passed; API 254 tests                                                                                                                                                    |
| C01   | Implemented and verified                           | OWNER/staff can enter `/checkin`; server role/password/session guards; restricted staff shell and event picker                                                                                                                              |
| C02   | Implemented and verified                           | Generated API requests, runtime guards, explicit states, stale-read rejection and synchronous confirmation lock                                                                                                                             |
| C03   | Implemented and verified                           | Manual QR/search/count/confirm; exact manual-status recovery survives rename/archive; no automatic mutation replay                                                                                                                          |
| C04   | Implemented; physical-device gate pending          | Actual ZXing decoder reads a synthetic video QR stream, stops owned tracks and only validates. Denial, event-change, sign-out and manual fallback browser cases pass. Physical iOS/Android cameras and trusted venue HTTPS are not verified |
| C05   | Implemented and verified                           | OWNER staff list/create/disable/activate/reset, one-time credentials, first-login change, backend denial and persisted session revocation                                                                                                   |
| C06   | Local integration passed                           | Six real Next/Nest/PostgreSQL browser cases; two operators produce one record, session attribution is correct, lost response recovers after archive/rename                                                                                  |
| R01   | Contract recorded                                  | Summary/event, RSVP/dietary/household, check-in/household/event, not-arrived/household/event; explicit archived inclusion                                                                                                                   |
| R02   | Implemented and verified                           | Repeatable-read projections; independent expected/actual aggregates; no join multiplication; OWNER-only and no bearer fields                                                                                                                |
| R03   | Implemented and verified                           | `/reports`, explicit refresh, expected/actual/counts, filters/pagination and server-generated CSV with Unicode/quoting/formula safety                                                                                                       |
| P00   | Local scope recorded                               | Preserve existing approved names/art/hero; use eligible API events; no invented parking/rundown/end time or CMS                                                                                                                             |
| P01   | Implemented and verified                           | Next future eligible event; no reorder/negative count; server-captured initial clock for hydration; silent minute display                                                                                                                   |
| P02   | Implemented and verified                           | Existing `Event.endsAt` exposed publicly; UTC ICS, optional end, UTF-8 folding/escaping; no personal URL or QR                                                                                                                              |
| P03   | Implemented and verified                           | Existing photos, on-demand lightbox, keyboard/Tab/Escape/focus return, 360/390/412 px checks                                                                                                                                                |
| P04   | Admin workflow implemented; final material pending | OWNER event-material form, persisted draft/publication, normalized image/PDF upload/library, credential-bound eligible media; final venue content still pending                                                                             |
| P05   | Admin workflow implemented; final schedule pending | OWNER activities/time editor, backend publish validation, WIB preview, separate published snapshot and explicit hide; mock does not publish automatically                                                                                   |
| A01   | Implemented and verified                           | Editable household message with eligible event details, current link reread before copy, rotation forces review; real test proves no open-count increment                                                                                   |
| Q01   | Local gates passed                                 | Unit/integration, public/admin browser, real DB workflows, optimized build and rendering baseline; physical screen-reader/device audit remains pending                                                                                      |
| Q02   | Configured; remote run pending                     | Existing CI extended with public/admin browser, built-public smoke, real workflow and real import gates. Equivalent commands run locally; no GitHub run was triggered                                                                       |
| Q03   | Artifacts ready; container gate blocked            | Dockerfile, isolated HTTPS Compose/Caddy stack, env example, starts/readiness/migration/runbook. Compose config validates. Docker Engine commands did not respond, so images/container runtime/TLS trust have not been verified             |
| Q04   | Local restore/rehearsal tooling verified           | Synthetic dump/restore preserves household, RSVP, pass, attendance, operator and migration facts. Hosted/platform logs, real devices and venue rehearsal remain external gates                                                              |

Public feature additions preserve the approved opening/hero and original assets. This remains one personal wedding application, with no theme builder, contact database, automatic messaging, offline check-in, or attendance corrections.

## Verification evidence (initial completion)

These totals describe the initial completion batch. The later venue-content slice is recorded separately below; unrelated API/admin/DB suites were not rerun for that presentation-only slice.

Commands below ran from this workspace with an isolated local QA `DATABASE_URL`, synthetic `CREDENTIAL_SECRET`, `INVITATION_DATABASE_TESTS=1`, and where relevant `INVITATION_WORKFLOW_TEST=1`. Tests are destructive to fixture tables; the configured development database was not used. Prisma-generating gates ran sequentially. Root test caching is disabled and Turborepo forwards the database-test flag, so a cached result cannot masquerade as database execution.

| Gate                                                                                         | Result                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:validate`                                                                           | Passed                                                                                                                                |
| `pnpm db:status`                                                                             | Three migrations, schema up to date on QA DB                                                                                          |
| `pnpm api:contract:generate`                                                                 | Passed; hashes unchanged on final regeneration (idempotent generation)                                                                |
| `pnpm lint`                                                                                  | Passed                                                                                                                                |
| `pnpm typecheck`                                                                             | Passed                                                                                                                                |
| `pnpm test`                                                                                  | Passed, cache bypassed: API 265, admin 298, public 185, API client 7 = 755 tests                                                      |
| `pnpm build`                                                                                 | All five workspace build tasks passed; both Next apps and compiled API                                                                |
| `pnpm --filter admin-web exec playwright test`                                               | 121 passed, including actual decoder over synthetic video and restricted-role routing                                                 |
| `pnpm --filter invitation-web exec playwright test`                                          | 55 passed, one intentional skip (performance is tested against `next start`)                                                          |
| `pnpm --filter invitation-web exec playwright test --config=playwright.production.config.ts` | Nine passed on the optimized public build                                                                                             |
| `pnpm --filter admin-web exec playwright test --config=playwright.real.config.ts`            | Six passed with compiled Nest and real PostgreSQL                                                                                     |
| `pnpm --filter admin-web exec playwright test --config=playwright.real-import.config.ts`     | Two passed: CSV and XLSX, exact recovery and persisted-data integrity                                                                 |
| `pnpm --filter api exec tsx scripts/local-backup-rehearsal.ts`                               | RESTORE_VERIFIED: invitations=1, rsvps=1, passes=1, records=1, correctOperator=1, migrations=3; restore DB and temporary dump removed |
| `docker compose -f compose.local-stack.yaml config --quiet`                                  | Passed with synthetic config-only env values; no daemon needed                                                                        |
| `git diff --check`                                                                           | Passed                                                                                                                                |

Admin browser coverage was 120/120 before adding the successful camera-decode case. The enlarged suite had one intermittent existing CSRF recovery case fail during concurrent load and pass on focused rerun. The sign-out control now stays disabled until hydration; the final enlarged suite passed all 121 tests. This is an observed test failure and a narrow interaction safeguard, not a claim that the timing cause was conclusively reproduced.

## Persisted-time correction found by regression

Independent pg reads in real import QA exposed a seven-hour disagreement with the ORM under a non-UTC PostgreSQL server session. `getDatabaseUrl` now appends `-c timezone=UTC` for all application/test pools while preserving other options. A real PostgreSQL test uses an independent pg connection in Asia/Jakarta and proves the exact start/end UTC instants. Both real CSV and XLSX import tests then passed with their original expected timestamps. No schema migration or development-data rewrite was performed. Historical data previously written with non-UTC sessions needs a separately reviewed audit before production.

## Rendering and privacy boundaries

The optimized closed-envelope render on unthrottled local Chromium with a synthetic API measured LCP 48-156 ms, CLS 0, no long tasks, and 147233 script transfer bytes. Local regression budgets are LCP below 2000 ms, CLS below 0.05, and scripts below 200000 bytes. These measurements do not establish real mobile/network/production performance or the full long-page LCP. Next emits an existing TikTok Sans fallback-metrics warning; the approved font was preserved.

All 31 pre-existing invitation assets, including the nine untracked reference PNGs and opened hero, matched their baseline SHA-256 hashes. No Katsudoto code or design assets were integrated. QR layout evidence uses geometry, not bearer screenshots; automatic screenshots/traces are disabled on sensitive suites. Invitation-web request logging is disabled, API credential redaction tests pass, and the proposed local edge discards logs. That edge/platform policy still needs runtime proof once Docker/hosting is available. Real screen-reader testing, physical camera compatibility, final content and production log review remain explicit unknowns.

## Repository boundary

HEAD remains `6bb089bf89ca36752c87a20d6625519101f3b42e` on `fix/checkin-manual-status-reconciliation`. No commit or staging operation was performed. Changes include the pre-existing manual-status work and this completion batch; original backend check-in implementation edits and reference assets were preserved. See `LOCAL-OPERATIONS.md` for local stack, backup/rollback and operator instructions.

The isolated PostgreSQL QA server was stopped after the final checks. Test web servers were managed and stopped by Playwright; no review deployment is left running.

## Venue-content follow-up (15 October 2026)

Owner authorized integrating the mock with tests after the format/template discussion. Scope: file-based local content reader, server validation, eligible-event presentation, synthetic development preview, and focused/public regression. No admin upload/editor, new backend route, DB change, dependency, production publication, commit or staging operation.

Runtime files: `apps/invitation-web/content/parking.json` and `rundown.json`, still `draft` with example copy/times and null IDs. Normal invitation requests never render drafts, including in development with the preview flag enabled. Only a validated `published` document with exact eligible Event UUIDs can render. Server validation limits each JSON to 64 KiB, fixed fields, bounded lists/text, proper ISO instants/order, approved HTTPS Maps links and flat local passive asset paths. Referenced assets must exist, have matching basic headers and be <=5 MiB; invalid references hide that guide. Header checks are not full file safety/integrity validation.

`/dev/venue-preview` requires development plus `VENUE_CONTENT_PREVIEW=1`; it is noindex, uses synthetic event labels and no guest/API/database data. Null draft IDs are bound only in this preview; no-eligible selection hides both sections. Production returns 404 even with the flag set. Preview opt-in cannot change the normal guest path. Missing/invalid data fails closed independently per document, without echoing content in public errors. The approval of final venue material and schedule remains outstanding.

Changes are limited to invitation-web content/reader/components/styles/route wiring, synthetic tests/config, the existing CI workflow's venue fixture step, and related docs. The original invitation assets and opening flow are preserved. No proprietary Katsudoto code/assets are used.

Build originally warned that a runtime-configured filesystem directory would trace the whole project. The loader now uses the compiler's filesystem tracing opt-out with explicit default content/venue asset includes in Next config. Final build no longer has that warning. Route manifests were checked for inclusion of both default JSONs and exclusion of .env files. The pre-existing TikTok Sans fallback-metrics warning remains.

Usage and replacing/publishing final materials: `PARKING-RUNDOWN-CONTENT.md`. Runtime edits are read on new page requests; container source changes still require image replacement or a configured content mount. The CSV is a worksheet only, not an implemented importer. Physical-device/accessibility, Docker runtime, remote CI, deployment and historical-time audit gates from the initial batch remain open.

Follow-up verification (from `apps/invitation-web` unless noted):

| Gate                                                                 | Result                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                          | Passed                                                                                                                                         |
| `pnpm typecheck`                                                     | Passed                                                                                                                                         |
| `pnpm test`                                                          | 227 passed across 16 files; 42 additional venue tests beyond the previous public total                                                         |
| `pnpm build`                                                         | Passed; default JSONs explicitly traced, no broad-workspace filesystem tracing warning                                                         |
| `pnpm exec playwright test`                                          | 57 passed, one intentional production-performance skip; includes draft isolation and preview with unchanged API request count                  |
| `pnpm exec playwright test --config=playwright.venue.config.ts`      | Two passed using separate published synthetic JSONs; ineligible ceremony content absent even from response HTML; 360/390/412px overflow checks |
| `pnpm exec playwright test --config=playwright.production.config.ts` | 11 passed; preview returns 404 in optimized production despite opt-in flag                                                                     |
| Initial draft-only focused browser run                               | Two passed before the final full regression                                                                                                    |
| Visual inspection                                                    | Synthetic draft preview screenshot at 390px reviewed; no real guest/QR data captured                                                           |
| Asset/opening integrity                                              | All 33 baseline files (31 assets and two opening components) retain SHA-256 hashes                                                             |

The published-fixture Playwright config initially failed to load because this workspace's config loader transpiles TypeScript as CommonJS and cannot execute `import.meta.dirname`. Using the config file's `__dirname` fixed it; the actual published browser cases then passed. No dependency or package module-mode change was needed.

No application DB was accessed for this slice. Test servers were stopped by Playwright. The runtime files remain draft; final-content gates remain open and OWNER upload/edit remains unimplemented. The remote CI workflow was extended, not triggered.

## OWNER event-material follow-up

The owner explicitly authorized the next admin feature based on the REA investigation. REA E3/E7 observed public rundown and the report cites vendor documentation on content/event-session management; authenticated editing, upload validation, storage and publication were not investigated. The implemented contracts/storage/UX are original designs. See `EVENT-CONTENT-ADMIN.md` for that boundary and the locked decisions.

Delivered: OWNER `/event-content`, parking and rundown forms with explicit WIB input, file upload/reference library, shared draft/published presentation, separate Save/Publish/Hide actions, reference-aware file deletion, version conflicts, uncertain-write recovery without replay, sign-out clearing and guarded discard/navigation. Native modal confirmations contain focus. CHECKIN_STAFF is denied by both route UX and shared backend security; the discovered admin route inventory is now 45 routes.

Additive migration `20261015090000_event_content` creates PostgreSQL draft/current-publication and bytea media tables. It was applied only to the isolated QA database. Development `.env` and database were not changed. Each mutation serializes on the Event row and checks a version; no Event time, RSVP, invitation or attendance writer is added. Image upload uses pinned sharp 0.35.4 already present transitively, now declared directly in api; it verifies extension/MIME/decoded PNG/JPEG/WebP format, bounds pixels/size, rejects animated input, re-encodes PNG and strips source metadata. PDF checks are bounded signature/EOF checks, attachment-only with sandbox/nosniff headers, not full sanitization or antivirus. Limits: 5 MiB and 8 files per Event.

Backend publication is now the guest source of truth. The normal invitation route reads the new credential-authorized venue-content endpoint and never falls back to local JSON. Asset reads require a currently active invitation, active eligible Event and reference from its current publication. Files are no-store and credential-bearing URLs stay same-origin with request logging redaction. Public content/media reads do not increment open aggregates. Previous JSON templates and dev preview remain separate mock-only tools.

Real PostgreSQL HTTP tests prove persisted drafts, separate publication after later edits, hide, no open-count mutation, simultaneous first-save winner/conflict, asset normalization/metadata stripping, same-Event ownership, referenced deletion guard, credential rotation, wrong-event/draft/hidden media denial, size/type/signature validation, OWNER/staff/unauth/CSRF/origin rules, incomplete-publication rejection. Real browser cases prove save/reload, upload and authenticated preview, publication and public page/proxy media, edit isolation, hide denial and lost-save response recovery with exactly one observed save request.

Backup/restore rehearsal now verifies both JSON states and exact media bytes in addition to household/RSVP/pass/attendance/operator data: RESTORE_VERIFIED, migrations=4, venueContent=1, matchingAsset=1. Temporary restore database/dump and owned fixtures were removed.

The QA cluster initially started without its explicit bind/port options and failed to bind the default socket; restart on the isolated loopback port 55432 succeeded. Real-browser harness errors (missing explicit workflow-test flag, broad status selector, normalized datetime-local fill value and select labels containing option text) were corrected; the latter improved real form labels. No production behavior was weakened to pass tests. A new transport test was moved into admin's configured `tests/**/*.test` glob and given the browser-equivalent relative Request base in the Node harness; all six transport cases then executed and passed.

Final OWNER event-material verification:

| Gate                                               | Result                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `pnpm lint`                                   | All five tasks passed                                                                                                                              |
| Root `pnpm typecheck`                              | All five tasks passed; Prisma-generating commands sequential                                                                                       |
| Root `pnpm test`                                   | All five tasks passed, uncached: API 284 + admin 306 + public 231 + API client 7 = **828**                                                         |
| Root `pnpm build`                                  | All five tasks passed; existing TikTok Sans warning remains                                                                                        |
| `pnpm db:validate` / `pnpm db:status`              | Valid schema; four migrations applied on isolated QA only                                                                                          |
| Final `pnpm api:contract:generate`                 | Idempotent OpenAPI/client hashes                                                                                                                   |
| Full admin mock browser                            | **121 passed**, including restricted staff navigation to new route                                                                                 |
| Full public mock browser                           | **57 passed**, one intentional performance skip                                                                                                    |
| Optimized public browser                           | **11 passed**, no draft-preview access in production                                                                                               |
| Published public fixture browser                   | **Two passed**, backend-shaped fixture and exact eligibility                                                                                       |
| Full real compiled-API/PostgreSQL browser workflow | **Eight passed** (six existing + two event-material cases)                                                                                         |
| Final event-material browser after styling         | **Two passed**, including native dialog, upload, actual public proxy media, lost response and 390px no-overflow check                              |
| Backup/restore                                     | RESTORE_VERIFIED: existing counts/attribution plus migrations=4, venueContent=1, matchingAsset=1                                                   |
| Visual review                                      | Final synthetic OWNER editor screenshot reviewed at 390px; scoped field/checkbox styles improved after initial review; no invitation/QR screenshot |
| Integrity                                          | All 33 protected asset/opening files preserve SHA-256; generated initially clean admin next-env noise restored                                     |
| Repository                                         | HEAD unchanged `6bb089bf89ca36752c87a20d6625519101f3b42e`; staging empty; no commit                                                                |

One public-fixture harness attempt overlapped the real workflow's port 3000 and stopped before tests due to port occupancy. After the real workflow completed, the isolated fixture run passed sequentially. Test servers were managed/stopped by Playwright, and the isolated PostgreSQL QA server was stopped. The configured development database and env files were not modified.

Known limits remain: no final venue/rundown material, no publication history or PDF antivirus, no OWNER CSV rundown importer, no new hosting/deployment or Docker runtime proof, no real-device/venue/accessibility sign-off and no remote CI run. The new migration must be reviewed/applied to the intended development database before this editor can be used there. Steps are in `PARKING-RUNDOWN-CONTENT.md`. No automatic data migration from draft JSON samples or publication of mock content occurs.
