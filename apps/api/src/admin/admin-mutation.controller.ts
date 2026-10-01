import {
  Body,
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type { RequestWithAdminContext } from "../common/admin-security.guard.js";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { isPublicRsvpDomainError } from "../invitations/public-rsvp.errors.js";
import { AdminMutationService } from "./admin-mutation.service.js";
import {
  AdminInvitationDetailResponseDto,
  AdminInvitationPublicUrlResponseDto,
  AdminRsvpDetailResponseDto,
} from "./dto/admin-read.dto.js";
import {
  AdminInviteeMutationDto,
  ArchiveAdminInvitationResponseDto,
  CreateAdminInviteeRequestDto,
  CreateAdminInvitationRequestDto,
  CreateAdminInvitationResponseDto,
  OverrideAdminRsvpRequestDto,
  RegenerateInvitationTokenRequestDto,
  ReplaceAdminInvitationEventsRequestDto,
  ReplaceAdminInvitationEventsResponseDto,
  UpdateAdminInviteeRequestDto,
  UpdateAdminInvitationRequestDto,
} from "./dto/admin-mutation.dto.js";

@ApiTags("Admin")
@Controller("api/admin/invitations")
export class AdminMutationController {
  constructor(
    @Inject(AdminMutationService)
    private readonly adminMutationService: AdminMutationService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create admin invitation" })
  @ApiBody({ type: CreateAdminInvitationRequestDto })
  @ApiCreatedResponse({ type: CreateAdminInvitationResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async createInvitation(
    @Body() body: CreateAdminInvitationRequestDto,
  ): Promise<CreateAdminInvitationResponseDto> {
    return this.adminMutationService.createInvitation(body);
  }

  @Patch(":invitationId")
  @HttpCode(200)
  @ApiOperation({ summary: "Update admin invitation" })
  @ApiBody({ type: UpdateAdminInvitationRequestDto })
  @ApiOkResponse({ type: AdminInvitationDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async updateInvitation(
    @Param("invitationId") invitationId: string,
    @Body() body: UpdateAdminInvitationRequestDto,
  ): Promise<AdminInvitationDetailResponseDto> {
    return this.adminMutationService.updateInvitation(invitationId, body);
  }

  @Post(":invitationId/archive")
  @HttpCode(200)
  @ApiOperation({ summary: "Archive admin invitation" })
  @ApiOkResponse({ type: ArchiveAdminInvitationResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async archiveInvitation(
    @Param("invitationId") invitationId: string,
    @Body() body: Record<string, never>,
  ): Promise<ArchiveAdminInvitationResponseDto> {
    return this.adminMutationService.archiveInvitation(invitationId, body);
  }

  @Post(":invitationId/regenerate-token")
  @HttpCode(200)
  @ApiOperation({ summary: "Regenerate admin invitation public URL" })
  @ApiBody({ type: RegenerateInvitationTokenRequestDto })
  @ApiOkResponse({ type: AdminInvitationPublicUrlResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async regenerateInvitationToken(
    @Param("invitationId") invitationId: string,
    @Body() body: RegenerateInvitationTokenRequestDto,
  ): Promise<AdminInvitationPublicUrlResponseDto> {
    return this.adminMutationService.regenerateInvitationToken(invitationId, body);
  }

  @Post(":invitationId/invitees")
  @ApiOperation({ summary: "Create admin invitation invitee" })
  @ApiBody({ type: CreateAdminInviteeRequestDto })
  @ApiCreatedResponse({ type: AdminInviteeMutationDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async createInvitee(
    @Param("invitationId") invitationId: string,
    @Body() body: CreateAdminInviteeRequestDto,
  ): Promise<AdminInviteeMutationDto> {
    return this.adminMutationService.createInvitee(invitationId, body);
  }

  @Put(":invitationId/events")
  @HttpCode(200)
  @ApiOperation({ summary: "Replace admin invitation eligibility" })
  @ApiBody({ type: ReplaceAdminInvitationEventsRequestDto })
  @ApiOkResponse({ type: ReplaceAdminInvitationEventsResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async replaceInvitationEvents(
    @Param("invitationId") invitationId: string,
    @Body() body: ReplaceAdminInvitationEventsRequestDto,
  ): Promise<ReplaceAdminInvitationEventsResponseDto> {
    return this.adminMutationService.replaceInvitationEvents(invitationId, body);
  }

  @Put(":invitationId/rsvp")
  @HttpCode(200)
  @ApiOperation({ summary: "Override admin RSVP" })
  @ApiBody({ type: OverrideAdminRsvpRequestDto })
  @ApiOkResponse({ type: AdminRsvpDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorEnvelopeDto })
  async overrideRsvp(
    @Param("invitationId") invitationId: string,
    @Body() body: OverrideAdminRsvpRequestDto,
    @Req() request: RequestWithAdminContext,
  ): Promise<AdminRsvpDetailResponseDto> {
    const adminUserId = request.admin?.user.id;

    if (adminUserId === undefined) {
      throw new Error("Admin context missing after security guard.");
    }

    try {
      return await this.adminMutationService.overrideRsvp(
        invitationId,
        body,
        adminUserId,
      );
    } catch (error) {
      if (isPublicRsvpDomainError(error)) {
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
}

@ApiTags("Admin")
@Controller("api/admin/invitees")
export class AdminInviteeMutationController {
  constructor(
    @Inject(AdminMutationService)
    private readonly adminMutationService: AdminMutationService,
  ) {}

  @Patch(":inviteeId")
  @HttpCode(200)
  @ApiOperation({ summary: "Update admin invitee" })
  @ApiBody({ type: UpdateAdminInviteeRequestDto })
  @ApiOkResponse({ type: AdminInviteeMutationDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async updateInvitee(
    @Param("inviteeId") inviteeId: string,
    @Body() body: UpdateAdminInviteeRequestDto,
  ): Promise<AdminInviteeMutationDto> {
    return this.adminMutationService.updateInvitee(inviteeId, body);
  }

  @Delete(":inviteeId")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete admin invitee" })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async deleteInvitee(@Param("inviteeId") inviteeId: string): Promise<void> {
    await this.adminMutationService.deleteInvitee(inviteeId);
  }
}
