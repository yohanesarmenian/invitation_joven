import { Inject, Injectable, ConflictException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { notFound, validationError } from "../auth/auth-errors.js";
import { UUID } from "../event-content/event-content.validation.js";
import { parseEvent } from "./event-management.validation.js";
import type {
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
    return {
      items: (
        await this.prisma.event.findMany({
          include,
          orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        })
      ).map(map),
    };
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
