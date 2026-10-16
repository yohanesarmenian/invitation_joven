import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { AdminRoles } from "../auth/admin-roles.decorator.js";
import type { RequestWithAdminContext } from "../common/admin-security.guard.js";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { AdminRole } from "../generated/prisma/client.js";
import { isInvitationNotAvailableError } from "../invitations/invitation-not-available.error.js";
import { CheckinService, type CheckinOperator } from "./checkin.service.js";
import { isCheckinDomainError } from "./checkin.errors.js";
import {
  AdminCheckinConfirmResponseDto,
  AdminCheckinEventsResponseDto,
  AdminCheckinManualStatusResponseDto,
  AdminCheckinSearchResponseDto,
  AdminCheckinValidateResponseDto,
  ConfirmAdminCheckinRequestDto,
  ManualConfirmAdminCheckinRequestDto,
  ManualStatusAdminCheckinRequestDto,
  ValidateAdminCheckinRequestDto,
  mapConfirmAdminCheckinRequest,
  mapManualConfirmAdminCheckinRequest,
  mapManualStatusAdminCheckinRequest,
  mapSearchAdminCheckinQuery,
  mapValidateAdminCheckinRequest,
} from "./dto/checkin.dto.js";

@ApiTags("Admin Check-in")
@AdminRoles(AdminRole.OWNER, AdminRole.CHECKIN_STAFF)
@Controller("api/admin/checkin")
export class CheckinController {
  constructor(
    @Inject(CheckinService)
    private readonly checkinService: CheckinService,
  ) {}

  @Get("events")
  @ApiOperation({ summary: "List active check-in events" })
  @ApiOkResponse({ type: AdminCheckinEventsResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  async listEvents(): Promise<AdminCheckinEventsResponseDto> {
    return this.checkinService.listEvents();
  }

  @Post("validate")
  @HttpCode(200)
  @ApiOperation({ summary: "Validate a check-in QR credential" })
  @ApiBody({ type: ValidateAdminCheckinRequestDto })
  @ApiOkResponse({ type: AdminCheckinValidateResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorEnvelopeDto })
  async validateQr(
    @Body() body: unknown,
  ): Promise<AdminCheckinValidateResponseDto> {
    try {
      return await this.checkinService.validateQr(
        mapValidateAdminCheckinRequest(body),
      );
    } catch (error) {
      this.rethrowCheckinError(error);
    }
  }

  @Post("confirm")
  @ApiOperation({ summary: "Confirm a QR check-in" })
  @ApiBody({ type: ConfirmAdminCheckinRequestDto })
  @ApiCreatedResponse({ type: AdminCheckinConfirmResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorEnvelopeDto })
  async confirmQr(
    @Body() body: unknown,
    @Req() request: RequestWithAdminContext,
  ): Promise<AdminCheckinConfirmResponseDto> {
    try {
      return await this.checkinService.confirmQr(
        mapConfirmAdminCheckinRequest(body),
        this.getOperator(request),
      );
    } catch (error) {
      this.rethrowCheckinError(error);
    }
  }

  @Get("search")
  @ApiOperation({ summary: "Search invitations eligible for manual check-in" })
  @ApiQuery({ minLength: 2, name: "query", required: true, type: String })
  @ApiQuery({ format: "uuid", name: "eventId", required: true, type: String })
  @ApiOkResponse({ type: AdminCheckinSearchResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorEnvelopeDto })
  async search(
    @Query() query: unknown,
  ): Promise<AdminCheckinSearchResponseDto> {
    try {
      return await this.checkinService.search(mapSearchAdminCheckinQuery(query));
    } catch (error) {
      this.rethrowCheckinError(error);
    }
  }

  @Post("manual-confirm")
  @ApiOperation({ summary: "Confirm a manual check-in" })
  @ApiBody({ type: ManualConfirmAdminCheckinRequestDto })
  @ApiCreatedResponse({ type: AdminCheckinConfirmResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorEnvelopeDto })
  async confirmManual(
    @Body() body: unknown,
    @Req() request: RequestWithAdminContext,
  ): Promise<AdminCheckinConfirmResponseDto> {
    try {
      return await this.checkinService.confirmManual(
        mapManualConfirmAdminCheckinRequest(body),
        this.getOperator(request),
      );
    } catch (error) {
      this.rethrowCheckinError(error);
    }
  }

  @Post("manual-status")
  @HttpCode(200)
  @ApiOperation({ summary: "Read exact manual check-in status" })
  @ApiBody({ type: ManualStatusAdminCheckinRequestDto })
  @ApiOkResponse({ type: AdminCheckinManualStatusResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  async readManualStatus(
    @Body() body: unknown,
  ): Promise<AdminCheckinManualStatusResponseDto> {
    try {
      return await this.checkinService.readManualStatus(
        mapManualStatusAdminCheckinRequest(body),
      );
    } catch (error) {
      this.rethrowCheckinError(error);
    }
  }

  private getOperator(request: RequestWithAdminContext): CheckinOperator {
    const user = request.admin?.user;

    if (user === undefined) {
      throw new Error("Admin context missing after security guard.");
    }

    return {
      email: user.email,
      id: user.id,
      role: user.role,
    };
  }

  private rethrowCheckinError(error: unknown): never {
    if (isInvitationNotAvailableError(error)) {
      throw new NotFoundException({
        code: error.code,
        details: error.details,
        message: error.message,
      });
    }

    if (isCheckinDomainError(error)) {
      const response = {
        code: error.code,
        details: error.details,
        message: error.message,
      };

      if (error.httpStatus === 409) {
        throw new ConflictException(response);
      }

      throw new UnprocessableEntityException(response);
    }

    throw error;
  }
}
