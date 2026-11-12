# Registered guest reception (Phase 4C)

Phase 4D replaces the Guest Assistance placeholder with direct walk-in registration and adds audited corrections/bounded operational exceptions. See [WALKIN-ATTENDANCE.md](WALKIN-ATTENDANCE.md) for the current extension and reporting/migration rules; the registered-guest behavior below remains supported.

HeyJo remains a single-wedding application. An OWNER provisions individual **Guest Manager** accounts in `/settings/staff`; the temporary-password and forced-password-change requirements still apply. Guest Managers sign in to `/reception`. They cannot enter the OWNER dashboard, invitation administration, staff settings, content settings, credential rotation, exports or unrestricted RSVP history. Disabling an account or resetting its password revokes its sessions.

`CHECKIN_STAFF` remains supported at `/checkin`, with the existing single-confirmation behavior. OWNER can use either workspace. The new operational workflow, including incremental arrivals, is `/reception`; it does not grant OWNER permissions to reception staff.

## Reception workflow

1. Select the existing wedding event (selected automatically when exactly one is active).
2. **Scan QR** to identify an Accepted household, or **Find Guest** using the household name, greeting, invited person's name or printed invitation reference.
3. Review eligibility, invitation allowance, expected guests, actual arrivals and remaining expected attendance. Archived/ineligible households may appear in search but cannot be checked in.
4. For Pending/Declined households, check the physical card or household details. Explicitly select the expected people, confirm the expected count, and enter a verification/changed-plans reason. The arriving count is separate. Declined changes require the same explicit reason and audit.
5. Review the confirmation dialog. Confirm once, then read the recorded arrival receipt. For a household expecting four guests, arrivals of 2, 1 and 1 produce one aggregate of four and three separate arrival entries.

No OWNER approval is required for an eligible registered household. No household is created when lookup finds nothing. **Guest Assistance** explains this boundary; registration of completely unregistered walk-ins belongs to Phase 4D.

If confirmation has an uncertain outcome, keep the household open and choose **Check operation status**. This reads the original operation receipt. If no receipt is yet visible, an operator may explicitly re-submit that same immutable operation. It is never silently retried with a new operation ID. Refreshing/closing the page loses that in-memory recovery command; search the household and review its canonical arrival history before recording anything else.

## API and privacy

All `/api/admin/reception/*` routes independently require an active OWNER or GUEST_MANAGER session. Unsafe requests retain CSRF and Origin checks; forced password change blocks operational access.

| Method | Route suffix                                        | Purpose                                  |
| ------ | --------------------------------------------------- | ---------------------------------------- |
| GET    | `/search?query=…&eventId=…&page=…`                  | Bounded lookup, 25 records per page      |
| GET    | `/households/:id?eventId=…`                         | Household capacity and arrival history   |
| POST   | `/validate`                                         | Validate the real check-in QR and event  |
| POST   | `/arrivals`                                         | Atomic arrival and optional on-site RSVP |
| GET    | `/operations/:operationId?invitationId=…&eventId=…` | Resolve a lost response without writing  |
| GET    | `/statistics?eventId=…`                             | Operational counts                       |

Search uses built-in PostgreSQL GIN full-text indexes with ANDed name prefixes, plus the unique reference index. Results are ordered by name and ID, with validated pagination. Search is not fuzzy matching. Lookups can show similar names for operator verification. The `query` parameter is redacted from application request logs.

References such as `HJ-000048` are stable, unique, printable identifiers, not credentials. Exact lookup accepts either case. They cannot open a public invitation or replace a check-in QR. Existing personal URLs and pass credentials are retained. Reception responses contain no invitation URLs, credential hashes, QR payloads or passwords. QR input stays in memory and is masked in the optional manual-entry field; it is not written to browser storage or arrival snapshots.

## Transaction and audit contract

Arrival mutations lock the invitation, verify the active operator and lock the event before checking eligibility/capacity. The optional on-site RSVP reuses the Phase 4B lifecycle **inside the same transaction** as the aggregate and append-only arrival. A failure anywhere rolls back RSVP, selected people/events, pass creation, RSVP history, aggregate and arrival. The first check-in still locks all guest-facing RSVP edits.

`ON_SITE_RSVP` history retains the actor, revision, before/after values, reason, verification method and timestamp. Guest Managers can review the current household's arrival entries, not the OWNER RSVP history endpoint. Each arrival retains household/event, count, operator ID and role, method, server time, operation ID and verification metadata. Subsequent arrivals reuse the existing active QR and pass; total actual attendance cannot exceed RSVP-expected attendance or the authorized invitation composition.

An operation UUID is globally unique. Its fingerprint binds the parsed non-secret command, resolved pass identity and operator. Identical replay returns the original receipt; changed input or a different operator conflicts. QR mutations revalidate the pass even on replay; read-only operation recovery remains available when a pass was subsequently revoked. Concurrent submissions serialize at the household lock and cannot consume the same remaining capacity twice.

## Storage, migration and reporting

Migration `20261111100000_reception_arrivals` is additive: new role, reference sequence/default/backfill, search indexes, optional audit verification field, and `checkin_arrivals`. Existing `CheckinRecord` remains the unique household/event aggregate used by existing reports. Its count becomes cumulative; its original confirmer, method and timestamp remain the first confirmation. Mixed-method attribution is available in the ledger and reception statistics, rather than inferred from that aggregate's first method.

Every old aggregate receives one arrival explicitly marked `migrated=true` and `MIGRATED_RECORD`, retaining its original count, operator, method and time. Its expected snapshot is at least the original actual count; it is a representation of persisted history, not a newly asserted arrival. Existing RSVP, aggregate and pass rows are not rewritten. The normal runtime role cannot update, delete or truncate arrival history, including deletion through the parent aggregate; only the separate table-owner/migration maintenance authority may do so.

Statistics distinguish registered households, Pending/Accepted/Declined, expected people, actual arrived people, partial/completed households, QR/manual people and on-site RSVP confirmations. Registered/status counts include event-linked archived historical households. Expected people include only active Accepted invitations; actual people retain persisted historical arrivals. QR/manual totals sum ledger people, including explicitly migrated records, not numbers of households. On-site confirmations count committed audit actions for the event. Existing OWNER dashboard/report totals continue to read the aggregate, avoiding double counting.

## Release and recovery procedure

Use the existing backup, image verification, protected release and migration gate. Before production migration, obtain and validate a current backup and rehearse restoration under the existing operations runbook. Apply with `pnpm db:migrate:deploy` using the separate migration role before accepting new application traffic. Do not use `db push`, reset data, replace the event or change existing invitation/pass credentials.

Local rehearsal used separate disposable PostgreSQL 18 databases: six old migrations plus persisted RSVP/check-in/pass fixtures followed by this migration; checksums of those old rows stayed identical and one migrated arrival was verified. A second fresh migration run with a non-superuser migration role verified runtime sequence/default permissions. Integration tests verify runtime ledger immutability and rollback on arrival-insert failure.

An application rollback does not undo the additive database migration. Preserve the arrival ledger and references. Pause reception writes if an older application version would not append arrival history; investigate with backup/receipt evidence before resuming. Never delete historical arrivals to make an old deployment work. This PR does not execute a production migration, deploy, register walk-ins or provide arrival correction APIs. Phase 4D must reuse these role boundaries, capacity locks, operation IDs and audit provenance for its separately approved registration/correction contract.
