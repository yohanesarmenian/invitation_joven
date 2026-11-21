import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBody,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { AdminRoles } from "../auth/admin-roles.decorator.js";
import { forbidden, validationError } from "../auth/auth-errors.js";
import type { RequestWithAdminContext } from "../common/admin-security.guard.js";
import { AdminRole } from "../generated/prisma/client.js";
import {
  CateringComparisonDto,
  CateringLiveDto,
  CateringSnapshotDto,
  FreezeCateringDto,
} from "./catering.dto.js";
import { CateringService } from "./catering.service.js";

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function eventId(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !uuid.test(value)) validationError();
  return value.toLowerCase();
}

function version(value: string) {
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647)
    validationError();
  return Number(value);
}

type CsvReply = { header(name: string, value: string): CsvReply };

@ApiTags("Catering reports")
@AdminRoles(AdminRole.OWNER)
@Controller("api/admin/reports/catering")
export class CateringController {
  constructor(
    @Inject(CateringService) private readonly catering: CateringService,
  ) {}

  @Get("live")
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "eventId", type: String, required: false })
  @ApiQuery({ name: "archived", enum: ["include", "exclude"], required: false })
  @ApiOkResponse({ type: CateringLiveDto })
  live(@Query() query: Record<string, unknown>) {
    if (
      Object.keys(query).some((key) => key !== "archived" && key !== "eventId")
    )
      validationError();
    const archived = query.archived ?? "exclude";
    if (archived !== "include" && archived !== "exclude") validationError();
    return this.catering.live({
      eventId: eventId(query.eventId ?? null),
      includeArchived: archived === "include",
    });
  }

  @Get("snapshots")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: [CateringSnapshotDto] })
  list() {
    return this.catering.list();
  }

  @Post("snapshots")
  @ApiBody({ type: FreezeCateringDto })
  @Header("Cache-Control", "no-store")
  @ApiCreatedResponse({ type: CateringSnapshotDto })
  freeze(
    @Body() body: FreezeCateringDto,
    @Req() request: RequestWithAdminContext,
  ) {
    if (!request.admin) forbidden();
    if (
      !body ||
      Object.keys(body).length !== 4 ||
      typeof body.operationId !== "string" ||
      !uuid.test(body.operationId) ||
      typeof body.includeArchived !== "boolean" ||
      !Number.isSafeInteger(body.expectedVersion) ||
      body.expectedVersion < 0 ||
      body.expectedVersion >= 2147483647
    )
      validationError();
    return this.catering.freeze(
      {
        ...body,
        operationId: body.operationId.toLowerCase(),
        eventId: eventId(body.eventId),
      },
      request.admin.user.id,
    );
  }

  @Get("snapshots/:version")
  @ApiParam({ name: "version", type: Number })
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: CateringComparisonDto })
  compare(@Param("version") raw: string) {
    return this.catering.compare(version(raw));
  }

  @Get("snapshots/:version/export")
  @ApiParam({ name: "version", type: Number })
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "kind", enum: ["summary", "households", "changes"] })
  @ApiProduces("text/csv")
  @ApiOkResponse({ schema: { type: "string" } })
  async export(
    @Param("version") raw: string,
    @Query("kind") kind: unknown,
    @Res({ passthrough: true }) reply: CsvReply,
  ) {
    if (kind !== "summary" && kind !== "households" && kind !== "changes")
      validationError();
    const parsed = version(raw);
    const body = await this.catering.export(parsed, kind);
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="catering-v${parsed}-${kind}.csv"`,
      );
    return body;
  }
}
