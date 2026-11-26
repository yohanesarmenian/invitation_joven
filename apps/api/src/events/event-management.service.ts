import { Inject, Injectable, ConflictException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { notFound, validationError } from "../auth/auth-errors.js";
import {
  EMPTY_VENUE_CONTENT,
  parseVenueBody,
  UUID,
} from "../event-content/event-content.validation.js";
import { parseEvent } from "./event-management.validation.js";
import type {
  EventOverviewDto,
  ManagedEventDto,
  ManagedEventsDto,
} from "./event-management.dto.js";

const include = {
  _count: {
    select: {
      invitationEvents: true,
      rsvpEventSelections: true,
      checkinRecords: true,
    },
  },
} satisfies Prisma.EventInclude;
type Row = Prisma.EventGetPayload<{ include: typeof include }>;
type Content = { draft: Prisma.JsonValue; published: Prisma.JsonValue };

function materialOverview(
  row: Content | undefined,
): Pick<EventOverviewDto, "parking" | "rundown"> {
  try {
    const draft = row ? parseVenueBody(row.draft) : EMPTY_VENUE_CONTENT;
    const published =
      row?.published == null ? null : parseVenueBody(row.published, true);
    const state = (key: "parking" | "rundown") =>
      published?.[key]
        ? isDeepStrictEqual(draft[key], published[key])
          ? "published"
          : "changed"
        : draft[key]
          ? "draft"
          : "missing";
    return { parking: state("parking"), rundown: state("rundown") };
  } catch {
    // An unreadable saved snapshot is distinct from an absent section.
    return { parking: "unavailable", rundown: "unavailable" };
  }
}
function map(row: Row): ManagedEventDto {
  return {
    id: row.id,
    version: row.version,
    slug: row.slug,
    name: row.name,
    description: row.description,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    venueName: row.venueName,
    address: row.address,
    googleMapsUrl: row.googleMapsUrl,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    usage: {
      invitations: row._count.invitationEvents,
      rsvps: row._count.rsvpEventSelections,
      checkins: row._count.checkinRecords,
    },
  };
}
function refuse(code: string): never {
  throw new ConflictException({
    code,
    message: "Event change conflicts with saved state",
    details: null,
  });
}
@Injectable()
export class EventManagementService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(): Promise<ManagedEventsDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const [events, eligibility, attendance, materials] = await Promise.all([
          tx.event.findMany({
            include,
            orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
          }),
          tx.invitationEvent.groupBy({
            by: ["eventId"],
            where: { invitation: { status: "ACTIVE" } },
            _count: { _all: true },
          }),
          tx.rSVPEventSelection.groupBy({
            by: ["eventId"],
            where: {
              attending: true,
              rsvp: { status: "ACCEPTED", invitation: { status: "ACTIVE" } },
            },
            _count: { _all: true },
            _sum: { expectedAttendeeCount: true },
          }),
          tx.eventContent.findMany({
            select: { eventId: true, draft: true, published: true },
          }),
        ]);
        // Each household has at most one eligibility link and one RSVP
        // selection per event. Neither count is a wedding-wide total.
        const eligibleByEvent = new Map(
          eligibility.map((row) => [row.eventId, row._count._all]),
        );
        const attendanceByEvent = new Map(
          attendance.map((row) => [row.eventId, row]),
        );
        const materialsByEvent = new Map(
          materials.map((row) => [row.eventId, row]),
        );
        return {
          items: events.map((event) => {
            const confirmed = attendanceByEvent.get(event.id);
            return {
              ...map(event),
              overview: {
                activeEligibleHouseholds: eligibleByEvent.get(event.id) ?? 0,
                acceptedHouseholds: confirmed?._count._all ?? 0,
                confirmedPeople: confirmed?._sum.expectedAttendeeCount ?? 0,
                ...materialOverview(materialsByEvent.get(event.id)),
              },
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async create(body: unknown): Promise<ManagedEventDto> {
    const { fields } = parseEvent(body);
    return this.unique(async () =>
      map(await this.prisma.event.create({ data: fields, include })),
    );
  }
  async save(id: string, body: unknown): Promise<ManagedEventDto> {
    if (!UUID.test(id)) validationError();
    const { fields, expectedVersion } = parseEvent(body, true);
    return this.unique(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id=${id}::uuid FOR UPDATE`;
        const row = await tx.event.findUnique({ where: { id }, include });
        if (!row) notFound();
        if (row.version !== expectedVersion) refuse("EVENT_VERSION_CONFLICT");
        const used =
          row._count.invitationEvents +
            row._count.rsvpEventSelections +
            row._count.checkinRecords >
          0;
        if (
          used &&
          (row.slug !== fields.slug || (row.isActive && !fields.isActive))
        )
          refuse("EVENT_IN_USE");
        if (
          row._count.checkinRecords > 0 &&
          (row.startsAt?.toISOString() !==
            (fields.startsAt === null
              ? undefined
              : new Date(fields.startsAt).toISOString()) ||
            row.endsAt?.toISOString() !==
              (fields.endsAt === null
                ? undefined
                : new Date(fields.endsAt).toISOString()))
        )
          refuse("EVENT_SCHEDULE_LOCKED");
        return map(
          await tx.event.update({
            where: { id },
            data: { ...fields, version: { increment: 1 } },
            include,
          }),
        );
      }),
    );
  }
  private async unique<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        refuse("EVENT_UNIQUE_CONFLICT");
      throw error;
    }
  }
}
