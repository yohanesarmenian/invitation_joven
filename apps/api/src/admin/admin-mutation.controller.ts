import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { AdminMutationService } from "./admin-mutation.service.js";
import {
  AdminInvitationDetailResponseDto,
  AdminInvitationPublicUrlResponseDto,
} from "./dto/admin-read.dto.js";
import {
  ArchiveAdminInvitationResponseDto,
  CreateAdminInvitationRequestDto,
  CreateAdminInvitationResponseDto,
  RegenerateInvitationTokenRequestDto,
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
}
