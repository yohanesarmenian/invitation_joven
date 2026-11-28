import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { conflict, notFound } from "../auth/auth-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma, type CateringSnapshot } from "../generated/prisma/client.js";
import type {
  CateringChangeDto,
  CateringScopeDto,
  CateringTotalsDto,
  FreezeCateringDto,
} from "./catering.dto.js";
import { csv } from "./csv.js";

type EventLabel = { id: string; name: string };
type HouseholdSession = {
  invitationId: string;
  eventId: string;
  archived: boolean;
  walkin: boolean;
  eligible: boolean;
  status: "ACCEPTED" | "DECLINED" | "PENDING";
  revision: number | null;
  namedInvitees: number;
  attending: boolean;
  rsvpExpected: number;
  capacityAdjustment: number;
  actual: number;
};
type CurrentRow = HouseholdSession & {
  latestAction: string | null;
  createdAt: Date;
};
type Baseline = {
  scope: { eventId: string | null; includeArchived: boolean };
  events: EventLabel[];
  rows: HouseholdSession[];
};

const repeatable = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
};
const schemaVersion = 1;
const expected = (row?: HouseholdSession) =>
  row ? row.rsvpExpected + row.capacityAdjustment : 0;
const inScope = (row: HouseholdSession, scope: CateringScopeDto) =>
  scope.includeArchived || !row.archived;
const key = (row: HouseholdSession) => `${row.invitationId}/${row.eventId}`;

// Include eligibility and historical attendance edges separately from selections.
// Those sets can differ, and a person may be expected in more than one session.
async function readRows(tx: Prisma.TransactionClient, events: string[]) {
  return tx.$queryRaw<CurrentRow[]>`
    WITH household_sessions AS (
      SELECT invitation_id, event_id FROM invitation_events
      UNION
      SELECT r.invitation_id, s.event_id FROM rsvp_event_selections s JOIN rsvps r ON r.id = s.rsvp_id
      UNION
      SELECT invitation_id, event_id FROM checkin_records
    ), named AS (
      SELECT invitation_id, count(*)::int AS people FROM invitees GROUP BY invitation_id
    ), adjustments AS (
      SELECT invitation_id, event_id, sum(capacity_delta)::int AS people
      FROM reception_actions GROUP BY invitation_id, event_id
    )
    SELECT i.id AS "invitationId", h.event_id AS "eventId",
      i.status = 'ARCHIVED' AS archived, w.id IS NOT NULL AS walkin,
      ie.invitation_id IS NOT NULL AS eligible,
      coalesce(r.status::text, 'PENDING') AS status, r.version AS revision,
      coalesce(n.people, 0) AS "namedInvitees",
      coalesce(r.status = 'ACCEPTED' AND s.attending, false) AS attending,
      CASE WHEN r.status = 'ACCEPTED' AND s.attending THEN s.expected_attendee_count ELSE 0 END AS "rsvpExpected",
      CASE WHEN r.status = 'ACCEPTED' AND s.attending THEN coalesce(a.people, 0) ELSE 0 END AS "capacityAdjustment",
      coalesce(c.attendee_count, 0) AS actual,
      hist.action AS "latestAction", i.created_at AS "createdAt"
    FROM household_sessions h
    JOIN invitations i ON i.id = h.invitation_id
    LEFT JOIN named n ON n.invitation_id = i.id
    LEFT JOIN adjustments a ON a.invitation_id = i.id AND a.event_id = h.event_id
    LEFT JOIN invitation_events ie ON ie.invitation_id = i.id AND ie.event_id = h.event_id
    LEFT JOIN rsvps r ON r.invitation_id = i.id
    LEFT JOIN rsvp_event_selections s ON s.rsvp_id = r.id AND s.event_id = h.event_id
    LEFT JOIN rsvp_change_events hist ON hist.rsvp_id = r.id AND hist.revision = r.version
    LEFT JOIN checkin_records c ON c.invitation_id = i.id AND c.event_id = h.event_id
    LEFT JOIN walkin_registrations w ON w.invitation_id = i.id
    WHERE h.event_id = ANY(${events}::uuid[])
    ORDER BY i.id, h.event_id
  `;
}

function totals(
  events: EventLabel[],
  rows: HouseholdSession[],
): CateringTotalsDto {
  const households = new Map(rows.map((row) => [row.invitationId, row]));
  const result: CateringTotalsDto = {
    households: households.size,
    namedInvitees: 0,
    accepted: 0,
    declined: 0,
    pending: 0,
    events: events.map((event) => ({
      ...event,
      expected: 0,
      rsvpExpected: 0,
      capacityAdjustment: 0,
      actual: 0,
      partialHouseholds: 0,
      walkinActual: 0,
    })),
  };
  for (const row of households.values()) {
    result.namedInvitees += row.namedInvitees;
    if (row.status === "ACCEPTED") result.accepted++;
    else if (row.status === "DECLINED") result.declined++;
    else result.pending++;
  }
  const byEvent = new Map(result.events.map((event) => [event.id, event]));
  for (const row of rows) {
    const event = byEvent.get(row.eventId)!;
    event.expected += expected(row);
    // Keep the historical adjusted total comparable to existing frozen snapshots.
    if (!row.walkin) event.rsvpExpected += row.rsvpExpected;
    event.capacityAdjustment += row.capacityAdjustment;
    event.actual += row.actual;
    if (row.actual > 0 && row.actual < expected(row)) event.partialHouseholds++;
    if (row.walkin) event.walkinActual += row.actual;
  }
  return result;
}

function diff(
  before: Baseline,
  current: CurrentRow[],
  capturedAt: Date,
): CateringChangeDto[] {
  const baselines = new Map(before.rows.map((row) => [key(row), row]));
  const currentRows = new Map(current.map((row) => [key(row), row]));
  const originalHouseholds = new Set(
    before.rows.map((row) => row.invitationId),
  );
  const changes: CateringChangeDto[] = [];
  for (const id of [
    ...new Set([...baselines.keys(), ...currentRows.keys()]),
  ].sort()) {
    const old = baselines.get(id);
    const raw = currentRows.get(id);
    const live = raw && inScope(raw, before.scope) ? raw : undefined;
    if (!old && !live) continue;
    const row = old ?? live!;
    const labels: string[] = [];
    const evidence: string[] = [];
    if (!old) {
      labels.push(
        originalHouseholds.has(row.invitationId)
          ? "SESSION_ADDED"
          : live!.createdAt > capturedAt
            ? "NEW_INVITATION"
            : "ENTERED_SCOPE",
      );
      if (live?.walkin) labels.push("WALK_IN");
    }
    if (raw?.archived && !old?.archived) labels.push("ARCHIVED");
    if (old?.archived && live && !live.archived) labels.push("RESTORED");
    if (old && !live) labels.push("LEFT_SCOPE");
    if (old && live && old.status !== live.status)
      labels.push("RSVP_STATUS_CHANGED");
    if (
      old &&
      live &&
      (old.attending !== live.attending || old.eligible !== live.eligible)
    )
      labels.push("SESSION_PARTICIPATION_CHANGED");
    if (old && live && old.namedInvitees !== live.namedInvitees)
      labels.push("INVITEE_COUNT_CHANGED");
    if (expected(live) !== expected(old))
      labels.push(
        expected(live) > expected(old)
          ? "EXPECTED_INCREASED"
          : "EXPECTED_DECREASED",
      );
    if ((live?.capacityAdjustment ?? 0) !== (old?.capacityAdjustment ?? 0)) {
      labels.push("CAPACITY_ADJUSTMENT_CHANGED");
      if (live) evidence.push("RECEPTION_CAPACITY_LEDGER");
    }
    if (!labels.length) continue;
    if (live?.latestAction && live.revision !== old?.revision)
      evidence.push(
        `LATEST_RSVP_REVISION_${live.revision}: ${live.latestAction}`,
      );
    // A linked revision can corroborate RSVP state. It cannot establish why
    // an invitation entered/left scope or why eligibility changed.
    if (
      !evidence.length ||
      labels.some((label) =>
        [
          "ENTERED_SCOPE",
          "LEFT_SCOPE",
          "ARCHIVED",
          "RESTORED",
          "INVITEE_COUNT_CHANGED",
        ].includes(label),
      )
    )
      evidence.push("CHANGE_CAUSE_NOT_VERIFIABLE");
    changes.push({
      invitationId: row.invitationId,
      eventId: row.eventId,
      previousStatus: old?.status ?? null,
      currentStatus: live?.status ?? null,
      frozenExpected: expected(old),
      currentExpected: expected(live),
      netChange: expected(live) - expected(old),
      changes: labels,
      evidence,
    });
  }
  return changes;
}

function baseline(row: CateringSnapshot): Baseline {
  if (row.schemaVersion !== schemaVersion)
    throw new Error("Unsupported catering snapshot schema.");
  return row.payload as unknown as Baseline;
}

function metadata(row: CateringSnapshot) {
  return {
    ...baseline(row).scope,
    version: row.version,
    schemaVersion: row.schemaVersion,
    capturedAt: row.capturedAt.toISOString(),
    capturedById: row.capturedById,
  };
}

@Injectable()
export class CateringService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async capture(tx: Prisma.TransactionClient, scope: CateringScopeDto) {
    const events = await tx.event.findMany({
      where: scope.eventId ? { id: scope.eventId } : {},
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    });
    if (scope.eventId && !events.length) notFound();
    const rows = await readRows(
      tx,
      events.map((event) => event.id),
    );
    return {
      events,
      rows: rows.filter((row) => inScope(row, scope)),
    };
  }

  async live(scope: CateringScopeDto) {
    return this.prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT statement_timestamp() AS now`;
      const { events, rows } = await this.capture(tx, scope);
      return {
        ...scope,
        generatedAt: clock!.now.toISOString(),
        totals: totals(events, rows),
      };
    }, repeatable);
  }

  async list() {
    const snapshots = await this.prisma.cateringSnapshot.findMany({
      orderBy: { version: "desc" },
    });
    return snapshots.map(metadata);
  }

  async freeze(input: FreezeCateringDto, ownerId: string) {
    const scope = {
      eventId: input.eventId,
      includeArchived: input.includeArchived,
    };
    // Recover an exact operation if a concurrent request committed first.
    // A different operation based on the same version must reload.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const view = await this.captureForFreeze(tx, input, ownerId, scope);
          return metadata(view);
        }, repeatable);
      } catch (error) {
        if (
          attempt > 0 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !["P2002", "P2034"].includes(error.code)
        )
          throw error;
      }
    }
  }

  private async captureForFreeze(
    tx: Prisma.TransactionClient,
    input: FreezeCateringDto,
    ownerId: string,
    scope: CateringScopeDto,
  ) {
    // The capture time anchors the same repeatable-read snapshot as all subsequent reads.
    const [clock] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT statement_timestamp() AS now`;
    const existing = await tx.cateringSnapshot.findUnique({
      where: { operationId: input.operationId },
    });
    if (existing) {
      const original = baseline(existing).scope;
      if (
        existing.capturedById !== ownerId ||
        existing.version !== input.expectedVersion + 1 ||
        original.eventId !== scope.eventId ||
        original.includeArchived !== scope.includeArchived
      )
        conflict("Freeze operation already belongs to a different request.");
      return existing;
    }
    const latest = await tx.cateringSnapshot.findFirst({
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const latestVersion = latest?.version ?? 0;
    // This view contains no receipt for this operation. A newer immutable
    // version means the original request can no longer claim its next version.
    if (latestVersion > input.expectedVersion)
      throw new ConflictException({
        code: "CATERING_SNAPSHOT_VERSION_CONFLICT",
        message: "Another catering snapshot was created.",
        details: { latestVersion },
      });
    if (latestVersion !== input.expectedVersion)
      conflict(
        "A catering snapshot was created. Reload before freezing another version.",
      );
    const { events, rows } = await this.capture(tx, scope);
    if (!events.length)
      conflict("Configure a wedding session before freezing catering numbers.");
    const view: Baseline = {
      scope,
      events,
      rows: rows.map((row) => ({
        invitationId: row.invitationId,
        eventId: row.eventId,
        archived: row.archived,
        walkin: row.walkin,
        eligible: row.eligible,
        status: row.status,
        revision: row.revision,
        namedInvitees: row.namedInvitees,
        attending: row.attending,
        rsvpExpected: row.rsvpExpected,
        capacityAdjustment: row.capacityAdjustment,
        actual: row.actual,
      })),
    };
    return tx.cateringSnapshot.create({
      data: {
        version: input.expectedVersion + 1,
        operationId: input.operationId,
        capturedAt: clock!.now,
        capturedById: ownerId,
        schemaVersion,
        payload: view,
      },
    });
  }

  private async find(tx: Prisma.TransactionClient, version: number) {
    const snapshot = await tx.cateringSnapshot.findUnique({
      where: { version },
    });
    if (!snapshot) notFound();
    return snapshot;
  }

  async compare(version: number) {
    return this.prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT statement_timestamp() AS now`;
      const snapshot = await this.find(tx, version);
      const stored = baseline(snapshot);
      const rows = await readRows(
        tx,
        stored.events.map((event) => event.id),
      );
      return {
        snapshot: metadata(snapshot),
        generatedAt: clock!.now.toISOString(),
        frozen: totals(stored.events, stored.rows),
        live: totals(
          stored.events,
          rows.filter((row) => inScope(row, stored.scope)),
        ),
        changes: diff(stored, rows, snapshot.capturedAt),
      };
    }, repeatable);
  }

  async export(version: number, kind: "summary" | "households" | "changes") {
    if (kind === "changes") {
      const comparison = await this.compare(version);
      return csv(
        [
          "schemaVersion",
          "snapshotVersion",
          "capturedAtUtc",
          "generatedAtUtc",
          "includeArchived",
          "invitationId",
          "eventId",
          "previousRsvp",
          "currentRsvp",
          "frozenExpected",
          "currentExpected",
          "netPeople",
          "changes",
          "evidence",
        ],
        comparison.changes.map((row) => [
          schemaVersion,
          version,
          comparison.snapshot.capturedAt,
          comparison.generatedAt,
          comparison.snapshot.includeArchived,
          row.invitationId,
          row.eventId,
          row.previousStatus,
          row.currentStatus,
          row.frozenExpected,
          row.currentExpected,
          row.netChange,
          row.changes.join(" | "),
          row.evidence.join(" | "),
        ]),
      );
    }
    const record = await this.find(this.prisma, version);
    const stored = baseline(record);
    const report = totals(stored.events, stored.rows);
    const stamp = [
      record.schemaVersion,
      version,
      record.capturedAt.toISOString(),
      stored.scope.includeArchived,
    ];
    const columns = [
      "schemaVersion",
      "snapshotVersion",
      "capturedAtUtc",
      "includeArchived",
    ];
    if (kind === "summary")
      return csv(
        [
          ...columns,
          "eventId",
          "eventName",
          "rsvpExpected",
          "capacityAdjustment",
          "expectedPeople",
        ],
        report.events.map((event) => [
          ...stamp,
          event.id,
          event.name,
          event.rsvpExpected,
          event.capacityAdjustment,
          event.expected,
        ]),
      );
    return csv(
      [
        ...columns,
        "invitationId",
        "eventId",
        "archived",
        "walkin",
        "eligible",
        "rsvpStatus",
        "namedInviteesInHousehold",
        "attending",
        "rsvpExpected",
        "capacityAdjustment",
        "expectedPeople",
      ],
      stored.rows.map((row) => [
        ...stamp,
        row.invitationId,
        row.eventId,
        row.archived,
        row.walkin,
        row.eligible,
        row.status,
        row.namedInvitees,
        row.attending,
        row.rsvpExpected,
        row.capacityAdjustment,
        expected(row),
      ]),
    );
  }
}
