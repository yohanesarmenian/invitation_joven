import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { AdminRoles } from "../auth/admin-roles.decorator.js";
import type { RequestWithAdminContext } from "../common/admin-security.guard.js";
import { AdminRole } from "../generated/prisma/client.js";
import { isCheckinDomainError } from "../checkin/checkin.errors.js";
import { isPublicRsvpDomainError } from "../invitations/public-rsvp.errors.js";
import { isInvitationNotAvailableError } from "../invitations/invitation-not-available.error.js";
import { ReceptionService } from "./reception.service.js";
import {
  ReceptionArrivalRequestDto,
  ReceptionDetailDto,
  ReceptionIdentifyDto,
  ReceptionOperationDto,
  ReceptionReceiptDto,
  ReceptionSearchDto,
  ReceptionStatisticsDto,
  arrivalRequest,
  identify,
  invalid,
  object,
  only,
  uuid,
} from "./reception.dto.js";

import { ReceptionActionsService } from "./reception-actions.service.js";
import {
  WalkinRequestDto,
  AttendanceActionRequestDto,
  ReceptionActionReceiptDto,
  ReceptionActionStatusDto,
  walkinRequest,
  actionRequest,
} from "./reception-actions.dto.js";
@ApiTags("Reception")
@AdminRoles(AdminRole.OWNER, AdminRole.GUEST_MANAGER)
@Controller("api/admin/reception")
export class ReceptionController {
  constructor(
    @Inject(ReceptionService) private readonly reception: ReceptionService,
    @Inject(ReceptionActionsService)
    private readonly actions: ReceptionActionsService,
  ) {}
  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (isCheckinDomainError(error) || isPublicRsvpDomainError(error))
        throw new HttpException(
          { code: error.code, details: null, message: error.message },
          error.httpStatus,
        );
      if (isInvitationNotAvailableError(error))
        throw new HttpException(
          {
            code: error.code,
            details: null,
            message: "Invitation unavailable",
          },
          404,
        );
      throw error;
    }
  }
  @Get("search")
  @ApiOperation({
    summary:
      "Find registered reception households; reference codes are not credentials",
  })
  @ApiQuery({
    name: "query",
    required: true,
    type: String,
    minLength: 2,
    maxLength: 100,
  })
  @ApiQuery({ name: "eventId", required: true, type: String, format: "uuid" })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 1000,
  })
  @ApiOkResponse({ type: ReceptionSearchDto })
  search(@Query() query: unknown) {
    if (!object(query)) invalid();
    only(query, ["query", "eventId", "page"]);
    if (
      typeof query.query !== "string" ||
      query.query.trim().length < 2 ||
      query.query.trim().length > 100
    )
      invalid();
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isInteger(page) || page < 1 || page > 1000) invalid();
    return this.run(() =>
      this.reception.search(
        (query.query as string).trim(),
        uuid(query.eventId),
        page,
      ),
    );
  }
  @Get("households/:id")
  @ApiParam({ name: "id", type: String, format: "uuid" })
  @ApiQuery({ name: "eventId", required: true, type: String, format: "uuid" })
  @ApiOkResponse({ type: ReceptionDetailDto })
  detail(@Param("id") id: string, @Query("eventId") eventId: string) {
    return this.run(() => this.reception.detail(uuid(id), uuid(eventId)));
  }
  @Post("validate")
  @HttpCode(200)
  @ApiBody({ type: ReceptionIdentifyDto })
  @ApiOkResponse({ type: ReceptionDetailDto })
  validate(@Body() body: unknown) {
    const input = identify(body);
    return this.run(() =>
      this.reception.identify(input.qrPayload, input.eventId),
    );
  }
  @Post("arrivals")
  @ApiBody({ type: ReceptionArrivalRequestDto })
  @ApiCreatedResponse({ type: ReceptionReceiptDto })
  arrive(@Body() body: unknown, @Req() request: RequestWithAdminContext) {
    const command = arrivalRequest(body);
    const user = request.admin?.user;
    if (!user) throw new Error("Reception context missing.");
    return this.run(() =>
      this.reception.arrive(command, {
        id: user.id,
        email: user.email,
        role: user.role,
      }),
    );
  }
  @Get("operations/:operationId")
  @ApiParam({ name: "operationId", type: String, format: "uuid" })
  @ApiQuery({
    name: "invitationId",
    required: true,
    type: String,
    format: "uuid",
  })
  @ApiQuery({ name: "eventId", required: true, type: String, format: "uuid" })
  @ApiOkResponse({ type: ReceptionOperationDto })
  operation(
    @Param("operationId") operationId: string,
    @Query("invitationId") invitationId: string,
    @Query("eventId") eventId: string,
  ) {
    return this.run(() =>
      this.reception.operation(
        uuid(operationId),
        uuid(invitationId),
        uuid(eventId),
      ),
    );
  }
  @Post("walkins")
  @ApiBody({ type: WalkinRequestDto })
  @ApiCreatedResponse({ type: ReceptionActionReceiptDto })
  register(@Body() body: unknown, @Req() request: RequestWithAdminContext) {
    const user = request.admin!.user;
    return this.run(() => this.actions.register(walkinRequest(body), user));
  }
  @Post("corrections")
  @ApiBody({ type: AttendanceActionRequestDto })
  @ApiCreatedResponse({ type: ReceptionActionReceiptDto })
  correct(@Body() body: unknown, @Req() request: RequestWithAdminContext) {
    return this.run(() =>
      this.actions.adjust(
        actionRequest(body),
        "CORRECTION",
        request.admin!.user,
      ),
    );
  }
  @Post("exceptions")
  @ApiBody({ type: AttendanceActionRequestDto })
  @ApiCreatedResponse({ type: ReceptionActionReceiptDto })
  exception(@Body() body: unknown, @Req() request: RequestWithAdminContext) {
    return this.run(() =>
      this.actions.adjust(
        actionRequest(body),
        "EXCEPTION",
        request.admin!.user,
      ),
    );
  }
  @Get("actions/:operationId")
  @ApiParam({ name: "operationId", type: String, format: "uuid" })
  @ApiOkResponse({ type: ReceptionActionStatusDto })
  actionStatus(
    @Param("operationId") id: string,
    @Req() request: RequestWithAdminContext,
  ) {
    return this.run(() => this.actions.status(uuid(id), request.admin!.user));
  }
  @Get("statistics")
  @ApiQuery({ name: "eventId", required: true, type: String, format: "uuid" })
  @ApiOkResponse({ type: ReceptionStatisticsDto })
  statistics(@Query("eventId") eventId: string) {
    return this.run(() => this.reception.statistics(uuid(eventId)));
  }
}
