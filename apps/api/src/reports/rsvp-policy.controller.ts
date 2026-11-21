import { Body, Controller, Get, Header, Inject, Put } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiProperty, ApiTags } from "@nestjs/swagger";
import { AdminRoles } from "../auth/admin-roles.decorator.js";
import { conflict, validationError } from "../auth/auth-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import { AdminRole } from "../generated/prisma/client.js";

class RsvpPolicyInputDto {
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  initialDeadlineAt!: string | null;

  @ApiProperty({ type: Boolean })
  allowLateEdits!: boolean;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  finalEditDeadlineAt!: string | null;
}

class UpdateRsvpPolicyDto extends RsvpPolicyInputDto {
  @ApiProperty({ type: Number })
  expectedVersion!: number;
}

class RsvpDeadlineExceptionDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String, format: "date-time" })
  rsvpDeadlineAt!: string;
}

class RsvpPolicyDto extends RsvpPolicyInputDto {
  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Number })
  activeExceptionCount!: number;

  @ApiProperty({ type: [RsvpDeadlineExceptionDto] })
  activeExceptions!: RsvpDeadlineExceptionDto[];
}

function instant(value: unknown): Date | null {
  if (value === null) return null;
  if (typeof value !== "string") validationError();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    validationError();
  return date;
}

@ApiTags("Wedding RSVP policy")
@AdminRoles(AdminRole.OWNER)
@Controller("api/admin/rsvp-policy")
export class RsvpPolicyController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: RsvpPolicyDto })
  async read(): Promise<RsvpPolicyDto> {
    const where = { status: "ACTIVE", rsvpDeadlineAt: { not: null } } as const;
    const [policy, activeExceptionCount, exceptions] =
      await this.prisma.$transaction(
        [
          this.prisma.weddingRsvpPolicy.findUniqueOrThrow({ where: { id: 1 } }),
          this.prisma.invitation.count({ where }),
          this.prisma.invitation.findMany({
            where,
            orderBy: [{ displayName: "asc" }, { id: "asc" }],
            take: 25,
            select: { id: true, displayName: true, rsvpDeadlineAt: true },
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
    return {
      initialDeadlineAt: policy.initialDeadlineAt?.toISOString() ?? null,
      finalEditDeadlineAt: policy.finalEditDeadlineAt?.toISOString() ?? null,
      allowLateEdits: policy.allowLateEdits,
      version: policy.version,
      activeExceptionCount,
      activeExceptions: exceptions.map((row) => ({
        ...row,
        rsvpDeadlineAt: row.rsvpDeadlineAt!.toISOString(),
      })),
    };
  }

  @Put()
  @ApiBody({ type: UpdateRsvpPolicyDto })
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: RsvpPolicyDto })
  async update(@Body() body: UpdateRsvpPolicyDto): Promise<RsvpPolicyDto> {
    if (
      !body ||
      Object.keys(body).length !== 4 ||
      typeof body.allowLateEdits !== "boolean" ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 1 ||
      body.expectedVersion >= 2147483647
    )
      validationError();
    const initialDeadlineAt = instant(body.initialDeadlineAt);
    const finalEditDeadlineAt = instant(body.finalEditDeadlineAt);
    if (
      finalEditDeadlineAt &&
      (!body.allowLateEdits ||
        !initialDeadlineAt ||
        finalEditDeadlineAt < initialDeadlineAt)
    )
      validationError();
    const result = await this.prisma.weddingRsvpPolicy.updateMany({
      where: { id: 1, version: body.expectedVersion },
      data: {
        initialDeadlineAt,
        finalEditDeadlineAt,
        allowLateEdits: body.allowLateEdits,
        version: { increment: 1 },
      },
    });
    if (!result.count)
      conflict("RSVP policy changed. Reload the current settings.");
    return this.read();
  }
}
