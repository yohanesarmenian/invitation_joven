import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma, CheckinArrival } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CheckinService,
  type CheckinOperator,
} from "../checkin/checkin.service.js";
import { PublicRsvpService } from "../invitations/public-rsvp.service.js";
import { lockEvents } from "../events/event-lock.js";
import type {
  ReceptionArrivalDto,
  ReceptionArrivalRequestDto,
  ReceptionDetailDto,
  ReceptionHouseholdDto,
  ReceptionSearchDto,
  ReceptionStatisticsDto,
} from "./reception.dto.js";

export const mapArrival = (row: CheckinArrival): ReceptionArrivalDto => ({
  operationId: row.operationId,
  attendeeCount: row.attendeeCount,
  expectedAttendeeCount: row.expectedAttendeeCount,
  totalAfter: row.totalAfter,
  checkedInAt: row.checkedInAt.toISOString(),
  method: row.method,
  operatorId: row.confirmedByAdminUserId,
  actorRole: row.actorRole,
  verificationMethod: row.verificationMethod,
  reason: row.reason,
  migrated: row.migrated,
});
const conflict = () => {
  throw new ConflictException({
    code: "RECEPTION_CONFLICT",
    details: null,
    message: "Reception state changed. Reload the household.",
  });
};

@Injectable()
export class ReceptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CheckinService) private readonly checkin: CheckinService,
    @Inject(PublicRsvpService) private readonly rsvp: PublicRsvpService,
  ) {}

  private async household(
    tx: Prisma.TransactionClient,
    id: string,
    eventId: string,
  ): Promise<ReceptionHouseholdDto> {
    const row = await tx.invitation.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        referenceCode: true,
        status: true,
        allowPlusOne: true,
        maxAdditionalChildren: true,
        invitees: {
          select: { id: true, fullName: true },
          orderBy: { displayOrder: "asc" },
        },
        invitationEvents: {
          where: { eventId },
          select: { event: { select: { isActive: true } } },
        },
        rsvp: {
          select: {
            version: true,
            status: true,
            eventSelections: {
              where: { eventId, attending: true },
              select: { expectedAttendeeCount: true },
            },
          },
        },
        checkinRecords: { select: { eventId: true, attendeeCount: true } },
      },
    });
    if (!row) throw new NotFoundException();
    const expectedCount =
      row.rsvp?.status === "ACCEPTED"
        ? (row.rsvp.eventSelections[0]?.expectedAttendeeCount ?? 0)
        : 0;
    const arrivedCount =
      row.checkinRecords.find((record) => record.eventId === eventId)
        ?.attendeeCount ?? 0;
    return {
      id: row.id,
      displayName: row.displayName,
      referenceCode: row.referenceCode,
      rsvpStatus: row.rsvp?.status ?? "PENDING",
      rsvpVersion: row.rsvp?.version ?? null,
      eligible:
        row.status === "ACTIVE" &&
        row.invitationEvents[0]?.event.isActive === true,
      rsvpLocked: row.checkinRecords.length > 0,
      allowedCount:
        row.invitees.length +
        (row.allowPlusOne ? 1 : 0) +
        row.maxAdditionalChildren,
      expectedCount,
      arrivedCount,
      remainingCount: Math.max(0, expectedCount - arrivedCount),
      allowPlusOne: row.allowPlusOne,
      maxAdditionalChildren: row.maxAdditionalChildren,
      invitees: row.invitees,
    };
  }

  async detail(id: string, eventId: string): Promise<ReceptionDetailDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const household = await this.household(tx, id, eventId);
        const arrivals = await tx.checkinArrival.findMany({
          where: { invitationId: id, eventId },
          orderBy: [{ checkedInAt: "desc" }, { id: "desc" }],
        });
        return { household, arrivals: arrivals.map(mapArrival) };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async search(
    query: string,
    eventId: string,
    page: number,
  ): Promise<ReceptionSearchDto> {
    const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!words.length) return { items: [], page, hasMore: false };
    const terms = words.map((word) => `${word}:*`).join(" & ");
    return this.prisma.$transaction(
      async (tx) => {
        // Each expression exactly matches a built-in GIN index. No raw user SQL.
        const rows = await tx.$queryRaw<{ id: string }[]>`
        WITH candidates AS (
          SELECT id FROM invitations WHERE reference_code = ${query.toUpperCase()}
          UNION SELECT id FROM invitations WHERE to_tsvector('simple',coalesce(display_name,'') || ' ' || coalesce(greeting_name,'')) @@ to_tsquery('simple',${terms})
          UNION SELECT invitation_id FROM invitees WHERE to_tsvector('simple',full_name) @@ to_tsquery('simple',${terms})
        ) SELECT i.id FROM invitations i JOIN candidates ON candidates.id=i.id
        ORDER BY i.display_name,i.id LIMIT 26 OFFSET ${(page - 1) * 25}`;
        const items: ReceptionHouseholdDto[] = [];
        for (const row of rows.slice(0, 25))
          items.push(await this.household(tx, row.id, eventId));
        return { items, page, hasMore: rows.length > 25 };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async identify(qrPayload: string, eventId: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      const pass = await this.checkin.identifyQrInTransaction(tx, qrPayload);
      await this.checkin.lockActiveInvitation(tx, pass.invitationId);
      await this.checkin.identifyQrInTransaction(tx, qrPayload);
      const household = await this.household(tx, pass.invitationId, eventId);
      if (
        !household.eligible ||
        household.rsvpStatus !== "ACCEPTED" ||
        household.expectedCount < 1
      )
        throw new UnprocessableEntityException({
          code: "EVENT_NOT_SELECTED",
          details: null,
          message: "This household cannot check in for this event.",
        });
      return pass.invitationId;
    });
    return this.detail(id, eventId);
  }

  async operation(operationId: string, invitationId: string, eventId: string) {
    const row = await this.prisma.checkinArrival.findUnique({
      where: { operationId },
    });
    return {
      arrival:
        row && row.invitationId === invitationId && row.eventId === eventId
          ? mapArrival(row)
          : null,
    };
  }

  async arrive(command: ReceptionArrivalRequestDto, operator: CheckinOperator) {
    return this.prisma.$transaction(async (tx) => {
      await this.checkin.lockActiveInvitation(tx, command.invitationId);
      const actors = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM admin_users WHERE id=${operator.id}::uuid AND status='ACTIVE' AND role::text=${operator.role} AND NOT must_change_password FOR SHARE`;
      if (!actors[0] || !["OWNER", "GUEST_MANAGER"].includes(operator.role))
        throw new ForbiddenException();
      await lockEvents(tx, [command.eventId]);
      const { qrPayload, ...nonSecret } = command;
      const pass = qrPayload
        ? await this.checkin.identifyQrInTransaction(tx, qrPayload)
        : null;
      if (pass && pass.invitationId !== command.invitationId) conflict();
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            operatorId: operator.id,
            command: nonSecret,
            passId: pass?.id ?? null,
          }),
        )
        .digest("hex");
      const previous = await tx.checkinArrival.findUnique({
        where: { operationId: command.operationId },
      });
      if (previous) {
        if (previous.payloadHash !== fingerprint) conflict();
        return { arrival: mapArrival(previous) };
      }
      const household = await this.household(
        tx,
        command.invitationId,
        command.eventId,
      );
      if (!household.eligible)
        throw new UnprocessableEntityException({
          code: "EVENT_NOT_ALLOWED",
          details: null,
          message: "Invitation is not eligible for this event.",
        });
      if (command.onSite) {
        if (operator.role !== "GUEST_MANAGER" && operator.role !== "OWNER")
          conflict();
        if (
          household.rsvpLocked ||
          household.rsvpStatus === "ACCEPTED" ||
          command.method !== "MANUAL"
        )
          conflict();
        // The operator explicitly supplies selected people, expected count, version and reason.
        if (
          command.onSite.eventSelections.length !== 1 ||
          command.onSite.eventSelections[0]?.eventId !== command.eventId ||
          !command.onSite.eventSelections[0].attending
        )
          conflict();
        await this.rsvp.submitOnSiteInTransaction(
          tx,
          {
            ...command.onSite,
            invitationId: command.invitationId,
            submittedByAdminUserId: operator.id,
            overrideReason: command.onSite.reason,
          },
          command.verificationMethod as
            "PHYSICAL_INVITATION" | "HOUSEHOLD_DETAILS",
        );
      } else if (household.rsvpStatus !== "ACCEPTED") conflict();
      await this.checkin.recordReceptionArrival(tx, {
        invitationId: command.invitationId,
        eventId: command.eventId,
        attendeeCount: command.attendeeCount,
        checkinPassId: pass?.id ?? null,
        method: command.method,
        operator,
        operationId: command.operationId,
        payloadHash: fingerprint,
        verificationMethod: command.verificationMethod,
        reason: command.onSite?.reason ?? null,
      });
      return {
        arrival: mapArrival(
          await tx.checkinArrival.findUniqueOrThrow({
            where: { operationId: command.operationId },
          }),
        ),
      };
    });
  }

  async statistics(eventId: string): Promise<ReceptionStatisticsDto> {
    const [row] = await this.prisma.$queryRaw<ReceptionStatisticsDto[]>`
      WITH households AS (
        SELECT i.id,i.status AS invitation_status,coalesce(r.status::text,'PENDING') AS status,
          CASE WHEN r.status='ACCEPTED' AND s.attending THEN s.expected_attendee_count ELSE 0 END AS expected,
          coalesce(c.attendee_count,0) AS arrived
        FROM invitations i JOIN invitation_events ie ON ie.invitation_id=i.id AND ie.event_id=${eventId}::uuid
        LEFT JOIN rsvps r ON r.invitation_id=i.id
        LEFT JOIN rsvp_event_selections s ON s.rsvp_id=r.id AND s.event_id=ie.event_id
        LEFT JOIN checkin_records c ON c.invitation_id=i.id AND c.event_id=ie.event_id
      ) SELECT count(*)::int AS "registeredHouseholds",
        count(*) FILTER (WHERE status='PENDING')::int AS "pendingHouseholds",
        count(*) FILTER (WHERE status='ACCEPTED')::int AS "acceptedHouseholds",
        count(*) FILTER (WHERE status='DECLINED')::int AS "declinedHouseholds",
        coalesce(sum(expected) FILTER (WHERE invitation_status='ACTIVE'),0)::int AS "expectedGuests",
        coalesce(sum(arrived),0)::int AS "arrivedGuests",
        count(*) FILTER (WHERE arrived>0 AND arrived<expected)::int AS "partialHouseholds",
        count(*) FILTER (WHERE arrived>0 AND arrived>=expected)::int AS "completedHouseholds",
        (SELECT coalesce(sum(attendee_count),0)::int FROM checkin_arrivals WHERE event_id=${eventId}::uuid AND method='QR') AS "qrGuests",
        (SELECT coalesce(sum(attendee_count),0)::int FROM checkin_arrivals WHERE event_id=${eventId}::uuid AND method='MANUAL') AS "manualGuests",
        (SELECT count(*)::int FROM rsvp_change_events WHERE action='ON_SITE_RSVP' AND updated_values->'eventSelections' @> ${JSON.stringify([{ eventId }])}::jsonb) AS "onSiteConfirmations"
        FROM households`;
    return row!;
  }
}
