import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { CredentialService } from "../security/credential.service.js";
import { createAdminInvitationGraph } from "../admin/admin-mutation.service.js";
import { PublicRsvpService } from "../invitations/public-rsvp.service.js";
import {
  CheckinService,
  type CheckinOperator,
} from "../checkin/checkin.service.js";
import {
  attendanceRevision,
  extraCapacity,
  receptionCandidates,
} from "./reception-accounting.js";
import type {
  AttendanceActionRequestDto,
  ReceptionActionReceiptDto,
  WalkinRequestDto,
} from "./reception-actions.dto.js";
const conflict = (code = "RECEPTION_CONFLICT"): never => {
  throw new ConflictException({
    code,
    message:
      "Reception state changed. Review the household and potential matches again.",
    details: null,
  });
};
function invalid(): never {
  throw new UnprocessableEntityException({
    code: "RECEPTION_LIMIT",
    message: "Attendance is outside the permitted operational limit.",
    details: null,
  });
}
@Injectable()
export class ReceptionActionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService) private readonly credentials: CredentialService,
    @Inject(PublicRsvpService) private readonly rsvp: PublicRsvpService,
    @Inject(CheckinService) private readonly checkin: CheckinService,
  ) {}
  private async begin(
    tx: Prisma.TransactionClient,
    operationId: string,
    command: unknown,
    kind: string,
    operator: CheckinOperator,
  ) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${operationId},0))`;
    // Serialize this operator's new exceptional actions for a database-backed rate limit.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${"reception-actor:" + operator.id},0))`;
    const users = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM admin_users WHERE id=${operator.id}::uuid AND status='ACTIVE' AND role::text=${operator.role} AND NOT must_change_password FOR SHARE`;
    if (!users.length || !["OWNER", "GUEST_MANAGER"].includes(operator.role))
      throw new ForbiddenException();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ kind, operatorId: operator.id, command }))
      .digest("hex");
    const previous = await tx.receptionAction.findUnique({
      where: { operationId },
    });
    if (previous) {
      if (previous.payloadHash !== fingerprint) conflict();
      return {
        fingerprint,
        receipt: previous.receipt as unknown as ReceptionActionReceiptDto,
      };
    }
    if (await tx.checkinArrival.findUnique({ where: { operationId } }))
      conflict();
    if (
      (await tx.receptionAction.count({
        where: {
          operatorId: operator.id,
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      })) >= 30
    )
      throw new HttpException(
        {
          code: "RECEPTION_RATE_LIMIT",
          message:
            "Too many reception changes. Pause and review recorded operations.",
          details: null,
        },
        429,
      );
    return { fingerprint, receipt: null };
  }
  async status(operationId: string, operator: CheckinOperator) {
    const row = await this.prisma.receptionAction.findUnique({
      where: { operationId },
    });
    if (row && row.operatorId !== operator.id && operator.role !== "OWNER")
      throw new ForbiddenException();
    return {
      receipt:
        (row?.receipt as unknown as ReceptionActionReceiptDto | null) ?? null,
    };
  }
  async register(command: WalkinRequestDto, operator: CheckinOperator) {
    return this.prisma.$transaction(
      async (tx) => {
        const op = await this.begin(
          tx,
          command.operationId,
          command,
          "WALKIN",
          operator,
        );
        if (op.receipt) return op.receipt;
        // Exclusive event lock also coordinates with existing graph creation's shared event lock.
        const events = await tx.$queryRaw<
          { id: string; isActive: boolean }[]
        >`SELECT id,is_active AS "isActive" FROM events WHERE id=${command.eventId}::uuid FOR UPDATE`;
        if (!events[0]?.isActive) invalid();
        const matches = await receptionCandidates(tx, command.leadName);
        if (
          matches.length > 25 ||
          JSON.stringify(matches.map((row) => row.id).sort()) !==
            JSON.stringify(command.reviewedMatchIds) ||
          (matches.length > 0 && !command.duplicateOverrideReason)
        )
          conflict("DUPLICATE_REVIEW_REQUIRED");
        const graph = await createAdminInvitationGraph(tx, this.credentials, {
          displayName: command.leadName,
          greetingName: command.leadName,
          eventIds: [command.eventId],
          invitees: [
            {
              fullName: command.leadName,
              category: "ADULT",
              label: "Lead guest",
            },
          ],
          allowPlusOne: false,
          maxAdditionalChildren: 0,
          notes: null,
          rsvpDeadlineAt: null,
        });
        await tx.invitation.update({
          where: { id: graph.id },
          data: { unnamedCompanionAllowance: command.expectedCount - 1 },
        });
        const lead = await tx.invitee.findFirstOrThrow({
          where: { invitationId: graph.id },
        });
        await this.rsvp.submitOnSiteInTransaction(
          tx,
          {
            invitationId: graph.id,
            submittedByAdminUserId: operator.id,
            overrideReason: command.reason,
            expectedVersion: null,
            status: "ACCEPTED",
            dietaryNotes: null,
            attendees: [
              { type: "NAMED_INVITEE", inviteeId: lead.id, quantity: 1 },
              ...(command.expectedCount > 1
                ? [
                    {
                      type: "UNNAMED_COMPANION" as const,
                      quantity: command.expectedCount - 1,
                    },
                  ]
                : []),
            ],
            eventSelections: [
              {
                eventId: command.eventId,
                attending: true,
                expectedAttendeeCount: command.expectedCount,
              },
            ],
          },
          command.verificationMethod,
        );
        await this.checkin.recordReceptionArrival(tx, {
          invitationId: graph.id,
          eventId: command.eventId,
          attendeeCount: command.arrivingCount,
          checkinPassId: null,
          method: "MANUAL",
          operator,
          operationId: command.operationId,
          payloadHash: op.fingerprint,
          verificationMethod: command.verificationMethod,
          reason: command.reason,
        });
        const invitation = await tx.invitation.findUniqueOrThrow({
          where: { id: graph.id },
        });
        const receipt: ReceptionActionReceiptDto = {
          operationId: command.operationId,
          kind: "WALKIN",
          invitationId: graph.id,
          eventId: command.eventId,
          displayName: invitation.displayName,
          referenceCode: invitation.referenceCode,
          arrivedCount: command.arrivingCount,
          expectedCount: command.expectedCount,
          remainingCount: command.expectedCount - command.arrivingCount,
          operatorId: operator.id,
          confirmedAt: new Date().toISOString(),
          delta: 0,
          capacityDelta: 0,
        };
        await tx.receptionAction.create({
          data: {
            operationId: command.operationId,
            kind: "WALKIN",
            invitationId: graph.id,
            eventId: command.eventId,
            operatorId: operator.id,
            actorRole: operator.role,
            payloadHash: op.fingerprint,
            reason: command.reason,
            verificationMethod: command.verificationMethod,
            receipt: { ...receipt },
          },
        });
        await tx.walkinRegistration.create({
          data: {
            invitationId: graph.id,
            operationId: command.operationId,
            leadName: command.leadName,
            companionCount: command.expectedCount - 1,
            expectedCount: command.expectedCount,
            arrivingCount: command.arrivingCount,
            affiliation: command.affiliation,
            duplicateOverrideReason: command.duplicateOverrideReason,
            reviewedMatchIds: command.reviewedMatchIds,
          },
        });
        return receipt;
      },
      { timeout: 15000 },
    );
  }
  async adjust(
    command: AttendanceActionRequestDto,
    kind: "CORRECTION" | "EXCEPTION",
    operator: CheckinOperator,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const op = await this.begin(
          tx,
          command.operationId,
          command,
          kind,
          operator,
        );
        if (op.receipt) return op.receipt;
        await this.checkin.lockActiveInvitation(tx, command.invitationId);
        const events = await tx.$queryRaw<
          { id: string; isActive: boolean }[]
        >`SELECT id,is_active AS "isActive" FROM events WHERE id=${command.eventId}::uuid FOR SHARE`;
        if (!events[0]?.isActive) invalid();
        const record = await tx.checkinRecord.findUnique({
          where: {
            invitationId_eventId: {
              invitationId: command.invitationId,
              eventId: command.eventId,
            },
          },
        });
        const rsvp = await tx.rSVP.findUnique({
          where: { invitationId: command.invitationId },
          include: {
            eventSelections: {
              where: { eventId: command.eventId, attending: true },
            },
          },
        });
        const eligible = await tx.invitationEvent.findUnique({
          where: {
            invitationId_eventId: {
              invitationId: command.invitationId,
              eventId: command.eventId,
            },
          },
        });
        if (
          !record ||
          !eligible ||
          rsvp?.status !== "ACCEPTED" ||
          !rsvp.eventSelections[0]
        )
          invalid();
        if (
          (await attendanceRevision(
            tx,
            command.invitationId,
            command.eventId,
          )) !== command.expectedRevision
        )
          conflict();
        const extras = await extraCapacity(
            tx,
            command.invitationId,
            command.eventId,
          ),
          base = rsvp.eventSelections[0].expectedAttendeeCount;
        const capacityDelta = kind === "EXCEPTION" ? command.count : 0;
        if (
          kind === "EXCEPTION" &&
          (command.count < 1 ||
            extras + command.count > 5 ||
            command.method !== "MANUAL")
        )
          invalid();
        const after =
            kind === "EXCEPTION"
              ? record.attendeeCount + command.count
              : command.count,
          delta = kind === "CORRECTION" ? after - record.attendeeCount : 0;
        if (
          after < 0 ||
          after > base + extras + capacityDelta ||
          (kind === "CORRECTION" && delta === 0)
        )
          invalid();
        if (kind === "CORRECTION") {
          const [net] = await tx.$queryRaw<
            { count: number }[]
          >`SELECT ((SELECT coalesce(sum(attendee_count),0) FROM checkin_arrivals WHERE invitation_id=${command.invitationId}::uuid AND event_id=${command.eventId}::uuid AND method=${command.method}::checkin_method)+(SELECT coalesce(sum(delta),0) FROM reception_actions WHERE invitation_id=${command.invitationId}::uuid AND event_id=${command.eventId}::uuid AND method=${command.method}::checkin_method))::int AS count`;
          if ((net?.count ?? 0) + delta < 0) invalid();
        }
        const invitation = await tx.invitation.findUniqueOrThrow({
          where: { id: command.invitationId },
        });
        const receipt: ReceptionActionReceiptDto = {
          operationId: command.operationId,
          kind,
          invitationId: command.invitationId,
          eventId: command.eventId,
          displayName: invitation.displayName,
          referenceCode: invitation.referenceCode,
          arrivedCount: after,
          expectedCount: base + extras + capacityDelta,
          remainingCount: base + extras + capacityDelta - after,
          operatorId: operator.id,
          confirmedAt: new Date().toISOString(),
          delta,
          capacityDelta,
        };
        await tx.receptionAction.create({
          data: {
            operationId: command.operationId,
            kind,
            invitationId: command.invitationId,
            eventId: command.eventId,
            operatorId: operator.id,
            actorRole: operator.role,
            payloadHash: op.fingerprint,
            reason: command.reason,
            verificationMethod: command.verificationMethod,
            delta,
            capacityDelta,
            method: command.method,
            receipt: { ...receipt },
          },
        });
        if (kind === "EXCEPTION")
          await this.checkin.recordReceptionArrival(tx, {
            invitationId: command.invitationId,
            eventId: command.eventId,
            attendeeCount: command.count,
            checkinPassId: null,
            method: "MANUAL",
            operator,
            operationId: command.operationId,
            payloadHash: op.fingerprint,
            verificationMethod: command.verificationMethod,
            reason: command.reason,
          });
        else
          await tx.checkinRecord.update({
            where: { id: record.id },
            data: { attendeeCount: after },
          });
        return receipt;
      },
      { timeout: 15000 },
    );
  }
}
