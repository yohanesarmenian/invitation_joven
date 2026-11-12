import { timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { InvitationStatus, RSVPStatus } from "../generated/prisma/client.js";
import { conflict, notFound, validationError } from "../auth/auth-errors.js";
import {
  buildAdminPageMetadata,
  parseAdminPagination,
  parseAdminSearch,
  parseAdminSort,
} from "../common/admin-query.js";
import { PrismaService } from "../database/prisma.service.js";
import { CredentialService } from "../security/credential.service.js";
import {
  adminGuestMessageHiddenFilters,
  adminGuestMessageSortFields,
  adminInvitationSortFields,
  adminInvitationStatuses,
  adminRsvpSortFields,
  adminRsvpStatuses,
  type AdminDashboardResponseDto,
  type AdminEventsResponseDto,
  type AdminGuestMessageHiddenFilter,
  type AdminGuestMessageItemDto,
  type AdminGuestMessageListResponseDto,
  type AdminGuestMessageSortField,
  type AdminInvitationDetailResponseDto,
  type AdminInvitationListResponseDto,
  type AdminInvitationPublicUrlResponseDto,
  type AdminInvitationStatus,
  type AdminRsvpDetailResponseDto,
  type AdminRsvpListResponseDto,
  type AdminRsvpSortField,
  type AdminRsvpStatus,
} from "./dto/admin-read.dto.js";
import { PublicInvitationBaseUrlService } from "./public-invitation-base-url.service.js";

function parseRsvpHistoryChanges(
  value: Prisma.JsonValue,
): AdminRsvpDetailResponseDto["history"][number]["changes"] {
  if (!Array.isArray(value)) throw new Error("Invalid RSVP history.");
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.field !== "string" ||
      typeof item.label !== "string" ||
      typeof item.before !== "string" ||
      typeof item.after !== "string"
    )
      throw new Error("Invalid RSVP history.");
    return {
      field: item.field,
      label: item.label,
      before: item.before,
      after: item.after,
    };
  });
}

type QueryBag = Record<string, unknown>;

type DashboardCountsRow = {
  active: bigint | number;
  archived: bigint | number;
  openedActive: bigint | number;
  pending: bigint | number;
  accepted: bigint | number;
  declined: bigint | number;
};

type ExpectedByEventRow = {
  eventId: string;
  slug: string;
  name: string;
  expectedAttendeeCount: bigint | number;
};

const INVITATION_SORT_MAP = {
  createdAt: "createdAt",
  displayName: "displayName",
  lastOpenedAt: "lastOpenedAt",
  status: "status",
  updatedAt: "updatedAt",
} satisfies Record<
  (typeof adminInvitationSortFields)[number],
  keyof Prisma.InvitationOrderByWithRelationInput
>;
const RSVP_SORT_MAP = {
  createdAt: "createdAt",
  status: "status",
  updatedAt: "lastUpdatedAt",
} satisfies Record<
  AdminRsvpSortField,
  keyof Prisma.RSVPOrderByWithRelationInput
>;
const GUEST_MESSAGE_SORT_MAP = {
  createdAt: "createdAt",
} satisfies Record<
  AdminGuestMessageSortField,
  keyof Prisma.GuestMessageOrderByWithRelationInput
>;
const MESSAGE_LIST_QUERY_FIELDS = new Set([
  "hidden",
  "invitationId",
  "page",
  "pageSize",
  "sortBy",
  "sortOrder",
]);
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function toIsoDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toIsoDateRequired(value: Date): string {
  return value.toISOString();
}

function toNumber(value: bigint | number): number {
  return Number(value);
}

function parseStatusFilter(value: unknown): AdminInvitationStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    Array.isArray(value) ||
    !adminInvitationStatuses.includes(value as AdminInvitationStatus)
  ) {
    validationError();
  }

  return value as AdminInvitationStatus;
}

function parseRsvpStatusFilter(value: unknown): AdminRsvpStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    Array.isArray(value) ||
    !adminRsvpStatuses.includes(value as AdminRsvpStatus)
  ) {
    validationError();
  }

  return value as AdminRsvpStatus;
}

function parseOptionalUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    Array.isArray(value) ||
    typeof value !== "string" ||
    !UUID_PATTERN.test(value)
  ) {
    validationError();
  }

  return value;
}

function assertMessageListQueryFields(query: QueryBag): void {
  for (const key of Object.keys(query)) {
    if (!MESSAGE_LIST_QUERY_FIELDS.has(key)) {
      validationError();
    }
  }
}

function parseHiddenFilter(value: unknown): AdminGuestMessageHiddenFilter {
  if (value === undefined || value === null || value === "") {
    return "all";
  }

  if (
    Array.isArray(value) ||
    !adminGuestMessageHiddenFilters.includes(
      value as AdminGuestMessageHiddenFilter,
    )
  ) {
    validationError();
  }

  return value as AdminGuestMessageHiddenFilter;
}

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    validationError();
  }
}

function credentialLookupHashesMatch(
  actual: string,
  expected: string,
): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function mapGuestMessageItem(input: {
  authorName: string | null;
  createdAt: Date;
  id: string;
  invitation: {
    displayName: string;
    id: string;
  };
  isHidden: boolean;
  message: string;
}): AdminGuestMessageItemDto {
  return {
    authorName: input.authorName,
    createdAt: toIsoDateRequired(input.createdAt),
    id: input.id,
    invitation: input.invitation,
    isHidden: input.isHidden,
    message: input.message,
  };
}

@Injectable()
export class AdminReadService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService)
    private readonly credentialService: CredentialService,
    @Inject(PublicInvitationBaseUrlService)
    private readonly publicBaseUrlService: PublicInvitationBaseUrlService,
  ) {}

  async getDashboard(): Promise<AdminDashboardResponseDto> {
    const { countsRows, expectedRows } = await this.prisma.$transaction(
      async (tx) => {
        const countsRows = await tx.$queryRaw<DashboardCountsRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE "i"."status" = 'ACTIVE')::int AS "active",
          COUNT(*) FILTER (WHERE "i"."status" = 'ARCHIVED')::int AS "archived",
          COUNT(*) FILTER (
            WHERE "i"."status" = 'ACTIVE' AND "i"."open_count" > 0
          )::int AS "openedActive",
          COUNT(*) FILTER (
            WHERE "i"."status" = 'ACTIVE'
              AND ("r"."id" IS NULL OR "r"."status" = 'PENDING')
          )::int AS "pending",
          COUNT(*) FILTER (
            WHERE "i"."status" = 'ACTIVE' AND "r"."status" = 'ACCEPTED'
          )::int AS "accepted",
          COUNT(*) FILTER (
            WHERE "i"."status" = 'ACTIVE' AND "r"."status" = 'DECLINED'
          )::int AS "declined"
        FROM "invitations" "i"
        LEFT JOIN "rsvps" "r" ON "r"."invitation_id" = "i"."id"
      `;
        const expectedRows = await tx.$queryRaw<ExpectedByEventRow[]>`
        SELECT
          "e"."id"::text AS "eventId",
          "e"."slug",
          "e"."name",
          COALESCE(SUM("s"."expected_attendee_count" + coalesce((SELECT sum(a.capacity_delta) FROM reception_actions a WHERE a.invitation_id="i"."id" AND a.event_id="e"."id"),0)), 0)::int AS "expectedAttendeeCount"
        FROM "rsvp_event_selections" "s"
        INNER JOIN "rsvps" "r" ON "r"."id" = "s"."rsvp_id"
        INNER JOIN "invitations" "i" ON "i"."id" = "r"."invitation_id"
        INNER JOIN "events" "e" ON "e"."id" = "s"."event_id"
        WHERE "i"."status" = 'ACTIVE'
          AND "r"."status" = 'ACCEPTED'
          AND "s"."attending" = true
        GROUP BY "e"."id", "e"."slug", "e"."name", "e"."display_order"
        ORDER BY "e"."display_order" ASC, "e"."id" ASC
      `;

        return { countsRows, expectedRows };
      },
    );
    const counts = countsRows[0] ?? {
      accepted: 0,
      active: 0,
      archived: 0,
      declined: 0,
      openedActive: 0,
      pending: 0,
    };

    return {
      expectedByEvent: expectedRows.map((row) => ({
        event: {
          id: row.eventId,
          name: row.name,
          slug: row.slug,
        },
        expectedAttendeeCount: toNumber(row.expectedAttendeeCount),
      })),
      invitations: {
        active: toNumber(counts.active),
        archived: toNumber(counts.archived),
        openedActive: toNumber(counts.openedActive),
      },
      rsvp: {
        accepted: toNumber(counts.accepted),
        declined: toNumber(counts.declined),
        pending: toNumber(counts.pending),
      },
    };
  }

  async getEvents(): Promise<AdminEventsResponseDto> {
    const events = await this.prisma.event.findMany({
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: {
        displayOrder: true,
        id: true,
        isActive: true,
        name: true,
        slug: true,
        startsAt: true,
        venueName: true,
        address: true,
      },
    });

    return {
      events: events.map((event) => ({
        ...event,
        startsAt: event.startsAt?.toISOString() ?? null,
      })),
    };
  }

  async listGuestMessages(
    query: QueryBag,
  ): Promise<AdminGuestMessageListResponseDto> {
    assertMessageListQueryFields(query);

    return this.listGuestMessagesForFilter({
      hidden: parseHiddenFilter(query.hidden),
      invitationId: parseOptionalUuid(query.invitationId),
      query,
    });
  }

  async listInvitationGuestMessages(
    invitationId: string,
    query: QueryBag,
  ): Promise<AdminGuestMessageListResponseDto> {
    assertUuid(invitationId);
    assertMessageListQueryFields(query);

    const queryInvitationId = parseOptionalUuid(query.invitationId);

    if (queryInvitationId !== null && queryInvitationId !== invitationId) {
      validationError();
    }

    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true },
    });

    if (invitation === null) {
      notFound();
    }

    return this.listGuestMessagesForFilter({
      hidden: parseHiddenFilter(query.hidden),
      invitationId,
      query,
    });
  }

  async listRsvps(query: QueryBag): Promise<AdminRsvpListResponseDto> {
    const page = parseAdminPagination(query);
    const sort = parseAdminSort(query, adminRsvpSortFields, {
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    const search = parseAdminSearch(query);
    const status = parseRsvpStatusFilter(query.status);
    const eventId = parseOptionalUuid(query.eventId);
    const where = this.buildRsvpListWhere({ eventId, search, status });
    const orderBy: Prisma.RSVPOrderByWithRelationInput[] = [
      { [RSVP_SORT_MAP[sort.sortBy]]: sort.sortOrder },
      { id: "asc" },
    ];
    const { rsvps, totalItems } = await this.prisma.$transaction(async (tx) => {
      const totalItems = await tx.rSVP.count({ where });
      const rsvps = await tx.rSVP.findMany({
        orderBy,
        skip: page.skip,
        take: page.pageSize,
        where,
        select: {
          attendees: { select: { quantity: true } },
          createdAt: true,
          eventSelections: { select: { attending: true } },
          id: true,
          invitation: {
            select: {
              displayName: true,
              id: true,
              status: true,
            },
          },
          lastUpdatedAt: true,
          status: true,
          submittedByAdminUserId: true,
          version: true,
        },
      });

      return { rsvps, totalItems };
    });

    return {
      items: rsvps.map((rsvp) => ({
        attendeeCount: rsvp.attendees.reduce(
          (total, attendee) => total + attendee.quantity,
          0,
        ),
        attendingEventCount: rsvp.eventSelections.filter(
          (selection) => selection.attending,
        ).length,
        createdAt: toIsoDateRequired(rsvp.createdAt),
        id: rsvp.id,
        invitation: rsvp.invitation,
        status: rsvp.status,
        submittedByAdmin: rsvp.submittedByAdminUserId !== null,
        updatedAt: toIsoDateRequired(rsvp.lastUpdatedAt),
        version: rsvp.version,
      })),
      page: buildAdminPageMetadata(page, totalItems),
    };
  }

  private async listGuestMessagesForFilter(input: {
    hidden: AdminGuestMessageHiddenFilter;
    invitationId: string | null;
    query: QueryBag;
  }): Promise<AdminGuestMessageListResponseDto> {
    const page = parseAdminPagination(input.query);
    const sort = parseAdminSort(input.query, adminGuestMessageSortFields, {
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    const where = this.buildGuestMessageListWhere({
      hidden: input.hidden,
      invitationId: input.invitationId,
    });
    const orderBy: Prisma.GuestMessageOrderByWithRelationInput[] = [
      { [GUEST_MESSAGE_SORT_MAP[sort.sortBy]]: sort.sortOrder },
      { id: "asc" },
    ];
    const { messages, totalItems } = await this.prisma.$transaction(
      async (tx) => {
        const totalItems = await tx.guestMessage.count({ where });
        const messages = await tx.guestMessage.findMany({
          orderBy,
          skip: page.skip,
          take: page.pageSize,
          where,
          select: {
            authorName: true,
            createdAt: true,
            id: true,
            invitation: {
              select: {
                displayName: true,
                id: true,
              },
            },
            isHidden: true,
            message: true,
          },
        });

        return { messages, totalItems };
      },
    );

    return {
      items: messages.map(mapGuestMessageItem),
      page: buildAdminPageMetadata(page, totalItems),
    };
  }

  async getRsvpDetail(rsvpId: string): Promise<AdminRsvpDetailResponseDto> {
    assertUuid(rsvpId);
    const rsvp = await this.prisma.$transaction(
      (tx) =>
        tx.rSVP.findUnique({
          where: { id: rsvpId },
          select: {
            adminOverrideReason: true,
            changes: {
              orderBy: { revision: "desc" },
              select: {
                id: true,
                createdAt: true,
                action: true,
                verificationMethod: true,
                actorCategory: true,
                actorRole: true,
                actorAdminUserId: true,
                revision: true,
                overrideReason: true,
                changes: true,
              },
            },
            attendees: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                attendeeType: true,
                displayName: true,
                inviteeId: true,
                quantity: true,
              },
            },
            checkinPasses: {
              orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
              select: {
                credentialVersion: true,
                expiresAt: true,
                issuedAt: true,
                revocationReason: true,
                revokedAt: true,
                status: true,
              },
            },
            createdAt: true,
            dietaryNotes: true,
            eventSelections: {
              orderBy: [
                { event: { displayOrder: "asc" } },
                { event: { id: "asc" } },
              ],
              select: {
                attending: true,
                event: {
                  select: {
                    displayOrder: true,
                    id: true,
                    isActive: true,
                    name: true,
                    slug: true,
                  },
                },
                expectedAttendeeCount: true,
              },
            },
            guestNote: true,
            id: true,
            invitation: {
              select: {
                displayName: true,
                id: true,
                status: true,
              },
            },
            lastUpdatedAt: true,
            status: true,
            submittedAt: true,
            submittedByAdminUser: {
              select: {
                email: true,
                id: true,
              },
            },
            submittedByAdminUserId: true,
            version: true,
          },
        }),
      { isolationLevel: "RepeatableRead" },
    );

    if (rsvp === null) {
      notFound();
    }

    return {
      history: rsvp.changes.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        changes: parseRsvpHistoryChanges(entry.changes),
      })),
      rsvp: {
        adminUser: rsvp.submittedByAdminUser ?? undefined,
        attendees: rsvp.attendees.map((attendee) => ({
          displayName: attendee.displayName,
          inviteeId: attendee.inviteeId,
          quantity: attendee.quantity,
          type: attendee.attendeeType,
        })),
        checkinPasses: rsvp.checkinPasses.map((pass) => ({
          credentialVersion: pass.credentialVersion,
          expiresAt: toIsoDate(pass.expiresAt),
          issuedAt: toIsoDateRequired(pass.issuedAt),
          revocationReason: pass.revocationReason,
          revokedAt: toIsoDate(pass.revokedAt),
          status: pass.status,
        })),
        createdAt: toIsoDateRequired(rsvp.createdAt),
        dietaryNotes: rsvp.dietaryNotes,
        eventSelections: rsvp.eventSelections.map((selection) => ({
          attending: selection.attending,
          event: selection.event,
          expectedAttendeeCount: selection.expectedAttendeeCount,
        })),
        guestNote: rsvp.guestNote,
        id: rsvp.id,
        invitation: rsvp.invitation,
        overrideReason: rsvp.adminOverrideReason ?? undefined,
        status: rsvp.status,
        submittedAt: toIsoDate(rsvp.submittedAt),
        submittedByAdmin: rsvp.submittedByAdminUserId !== null,
        updatedAt: toIsoDateRequired(rsvp.lastUpdatedAt),
        version: rsvp.version,
      },
    };
  }

  async listInvitations(
    query: QueryBag,
  ): Promise<AdminInvitationListResponseDto> {
    const page = parseAdminPagination(query);
    const sort = parseAdminSort(query, adminInvitationSortFields, {
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    const search = parseAdminSearch(query);
    const status = parseStatusFilter(query.status);
    const rsvpStatus = parseRsvpStatusFilter(query.rsvpStatus);
    const where = this.buildInvitationListWhere({ rsvpStatus, search, status });
    const orderBy: Prisma.InvitationOrderByWithRelationInput[] = [
      { [INVITATION_SORT_MAP[sort.sortBy]]: sort.sortOrder },
      { id: "asc" },
    ];
    const { invitations, totalItems } = await this.prisma.$transaction(
      async (tx) => {
        const totalItems = await tx.invitation.count({ where });
        const invitations = await tx.invitation.findMany({
          orderBy,
          skip: page.skip,
          take: page.pageSize,
          where,
          select: {
            _count: { select: { invitees: true } },
            archivedAt: true,
            createdAt: true,
            displayName: true,
            greetingName: true,
            id: true,
            lastOpenedAt: true,
            openCount: true,
            rsvp: { select: { status: true } },
            rsvpDeadlineAt: true,
            status: true,
            updatedAt: true,
          },
        });

        return { invitations, totalItems };
      },
    );

    return {
      items: invitations.map((invitation) => ({
        archivedAt: toIsoDate(invitation.archivedAt),
        createdAt: toIsoDateRequired(invitation.createdAt),
        displayName: invitation.displayName,
        greetingName: invitation.greetingName,
        id: invitation.id,
        inviteeCount: invitation._count.invitees,
        lastOpenedAt: toIsoDate(invitation.lastOpenedAt),
        openCount: invitation.openCount,
        rsvpDeadlineAt: toIsoDate(invitation.rsvpDeadlineAt),
        rsvpStatus: invitation.rsvp?.status ?? RSVPStatus.PENDING,
        status: invitation.status,
        updatedAt: toIsoDateRequired(invitation.updatedAt),
      })),
      page: buildAdminPageMetadata(page, totalItems),
    };
  }

  async getInvitationDetail(
    invitationId: string,
  ): Promise<AdminInvitationDetailResponseDto> {
    const { hiddenMessages, invitation, totalMessages } =
      await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.invitation.findUnique({
          where: { id: invitationId },
          select: {
            archivedAt: true,
            allowPlusOne: true,
            checkinPasses: {
              orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
              select: {
                credentialVersion: true,
                expiresAt: true,
                issuedAt: true,
                revocationReason: true,
                revokedAt: true,
                status: true,
              },
            },
            createdAt: true,
            displayName: true,
            firstOpenedAt: true,
            greetingName: true,
            id: true,
            invitationEvents: {
              orderBy: [
                { event: { displayOrder: "asc" } },
                { event: { id: "asc" } },
              ],
              select: {
                event: {
                  select: {
                    displayOrder: true,
                    id: true,
                    isActive: true,
                    name: true,
                    slug: true,
                  },
                },
              },
            },
            invitees: {
              orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
              select: {
                category: true,
                displayOrder: true,
                fullName: true,
                id: true,
                label: true,
                updatedAt: true,
              },
            },
            lastOpenedAt: true,
            maxAdditionalChildren: true,
            notes: true,
            openCount: true,
            publicTokenVersion: true,
            rsvp: {
              select: {
                lastUpdatedAt: true,
                status: true,
                submittedAt: true,
                version: true,
              },
            },
            rsvpDeadlineAt: true,
            status: true,
            updatedAt: true,
          },
        });
        const totalMessages = await tx.guestMessage.count({
          where: { invitationId },
        });
        const hiddenMessages = await tx.guestMessage.count({
          where: { invitationId, isHidden: true },
        });

        return { hiddenMessages, invitation, totalMessages };
      });

    if (invitation === null) {
      notFound();
    }

    return {
      invitation: {
        archivedAt: toIsoDate(invitation.archivedAt),
        allowPlusOne: invitation.allowPlusOne,
        checkinPasses: invitation.checkinPasses.map((pass) => ({
          credentialVersion: pass.credentialVersion,
          expiresAt: toIsoDate(pass.expiresAt),
          issuedAt: toIsoDateRequired(pass.issuedAt),
          revocationReason: pass.revocationReason,
          revokedAt: toIsoDate(pass.revokedAt),
          status: pass.status,
        })),
        createdAt: toIsoDateRequired(invitation.createdAt),
        displayName: invitation.displayName,
        eligibility: invitation.invitationEvents.map((invitationEvent) => ({
          event: invitationEvent.event,
        })),
        firstOpenedAt: toIsoDate(invitation.firstOpenedAt),
        greetingName: invitation.greetingName,
        id: invitation.id,
        invitees: invitation.invitees.map((invitee) => ({
          category: invitee.category,
          displayOrder: invitee.displayOrder,
          fullName: invitee.fullName,
          id: invitee.id,
          label: invitee.label,
          updatedAt: toIsoDateRequired(invitee.updatedAt),
        })),
        lastOpenedAt: toIsoDate(invitation.lastOpenedAt),
        maxAdditionalChildren: invitation.maxAdditionalChildren,
        messages: {
          hidden: hiddenMessages,
          total: totalMessages,
        },
        notes: invitation.notes,
        openCount: invitation.openCount,
        publicTokenVersion: invitation.publicTokenVersion,
        rsvp:
          invitation.rsvp === null
            ? null
            : {
                lastUpdatedAt: toIsoDateRequired(invitation.rsvp.lastUpdatedAt),
                status: invitation.rsvp.status,
                submittedAt: toIsoDate(invitation.rsvp.submittedAt),
                version: invitation.rsvp.version,
              },
        rsvpDeadlineAt: toIsoDate(invitation.rsvpDeadlineAt),
        status: invitation.status,
        updatedAt: toIsoDateRequired(invitation.updatedAt),
      },
    };
  }

  async getInvitationPublicUrl(
    invitationId: string,
  ): Promise<AdminInvitationPublicUrlResponseDto> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        publicTokenHash: true,
        publicTokenVersion: true,
        status: true,
      },
    });

    if (invitation === null) {
      notFound();
    }

    if (invitation.status !== InvitationStatus.ACTIVE) {
      conflict("Invitation is archived.");
    }

    const credential = this.credentialService.deriveCredential({
      namespace: "invitation",
      stableId: invitation.id,
      version: invitation.publicTokenVersion,
    });
    const hash = this.credentialService.hashCredential(credential);

    if (!credentialLookupHashesMatch(hash, invitation.publicTokenHash)) {
      throw new Error("Invitation public credential integrity check failed.");
    }

    return {
      publicTokenVersion: invitation.publicTokenVersion,
      publicUrl: this.publicBaseUrlService.buildInvitationUrl(credential),
    };
  }

  private buildInvitationListWhere(input: {
    rsvpStatus: AdminRsvpStatus | null;
    search: string | null;
    status: AdminInvitationStatus | null;
  }): Prisma.InvitationWhereInput {
    const and: Prisma.InvitationWhereInput[] = [];

    if (input.status !== null) {
      and.push({ status: input.status });
    }

    if (input.rsvpStatus === RSVPStatus.PENDING) {
      and.push({
        OR: [
          { rsvp: { is: null } },
          { rsvp: { is: { status: RSVPStatus.PENDING } } },
        ],
      });
    } else if (input.rsvpStatus !== null) {
      and.push({ rsvp: { is: { status: input.rsvpStatus } } });
    }

    if (input.search !== null) {
      and.push({
        OR: [
          { displayName: { contains: input.search, mode: "insensitive" } },
          { greetingName: { contains: input.search, mode: "insensitive" } },
          {
            invitees: {
              some: {
                fullName: { contains: input.search, mode: "insensitive" },
              },
            },
          },
        ],
      });
    }

    return and.length === 0 ? {} : { AND: and };
  }

  private buildRsvpListWhere(input: {
    eventId: string | null;
    search: string | null;
    status: AdminRsvpStatus | null;
  }): Prisma.RSVPWhereInput {
    const and: Prisma.RSVPWhereInput[] = [];

    if (input.status !== null) {
      and.push({ status: input.status });
    }

    if (input.eventId !== null) {
      and.push({ eventSelections: { some: { eventId: input.eventId } } });
    }

    if (input.search !== null) {
      and.push({
        invitation: {
          OR: [
            { displayName: { contains: input.search, mode: "insensitive" } },
            { greetingName: { contains: input.search, mode: "insensitive" } },
            {
              invitees: {
                some: {
                  fullName: { contains: input.search, mode: "insensitive" },
                },
              },
            },
          ],
        },
      });
    }

    return and.length === 0 ? {} : { AND: and };
  }

  private buildGuestMessageListWhere(input: {
    hidden: AdminGuestMessageHiddenFilter;
    invitationId: string | null;
  }): Prisma.GuestMessageWhereInput {
    const and: Prisma.GuestMessageWhereInput[] = [];

    if (input.invitationId !== null) {
      and.push({ invitationId: input.invitationId });
    }

    if (input.hidden === "visible") {
      and.push({ isHidden: false });
    } else if (input.hidden === "hidden") {
      and.push({ isHidden: true });
    }

    return and.length === 0 ? {} : { AND: and };
  }
}
