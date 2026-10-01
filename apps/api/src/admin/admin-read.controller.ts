import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { AdminReadService } from "./admin-read.service.js";
import {
  AdminDashboardResponseDto,
  AdminEventsResponseDto,
  AdminInvitationDetailResponseDto,
  AdminInvitationListQueryDto,
  AdminInvitationListResponseDto,
  AdminInvitationPublicUrlResponseDto,
  AdminRsvpDetailResponseDto,
  AdminRsvpListQueryDto,
  AdminRsvpListResponseDto,
} from "./dto/admin-read.dto.js";

@ApiTags("Admin")
@Controller("api/admin")
export class AdminReadController {
  constructor(
    @Inject(AdminReadService) private readonly adminReadService: AdminReadService,
  ) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Get admin dashboard metrics" })
  @ApiOkResponse({ type: AdminDashboardResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  async getDashboard(): Promise<AdminDashboardResponseDto> {
    return this.adminReadService.getDashboard();
  }

  @Get("events")
  @ApiOperation({ summary: "List admin event catalog" })
  @ApiOkResponse({ type: AdminEventsResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  async getEvents(): Promise<AdminEventsResponseDto> {
    return this.adminReadService.getEvents();
  }

  @Get("rsvps")
  @ApiOperation({ summary: "List admin RSVPs" })
  @ApiOkResponse({ type: AdminRsvpListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  async listRsvps(
    @Query() query: AdminRsvpListQueryDto,
  ): Promise<AdminRsvpListResponseDto> {
    return this.adminReadService.listRsvps(query as Record<string, unknown>);
  }

  @Get("rsvps/:rsvpId")
  @ApiOperation({ summary: "Get admin RSVP detail" })
  @ApiOkResponse({ type: AdminRsvpDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  async getRsvpDetail(
    @Param("rsvpId") rsvpId: string,
  ): Promise<AdminRsvpDetailResponseDto> {
    return this.adminReadService.getRsvpDetail(rsvpId);
  }

  @Get("invitations")
  @ApiOperation({ summary: "List admin invitations" })
  @ApiOkResponse({ type: AdminInvitationListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  async listInvitations(
    @Query() query: AdminInvitationListQueryDto,
  ): Promise<AdminInvitationListResponseDto> {
    return this.adminReadService.listInvitations(query as Record<string, unknown>);
  }

  @Get("invitations/:invitationId")
  @ApiOperation({ summary: "Get admin invitation detail" })
  @ApiOkResponse({ type: AdminInvitationDetailResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  async getInvitationDetail(
    @Param("invitationId") invitationId: string,
  ): Promise<AdminInvitationDetailResponseDto> {
    return this.adminReadService.getInvitationDetail(invitationId);
  }

  @Get("invitations/:invitationId/public-url")
  @ApiOperation({ summary: "Get current public invitation URL" })
  @ApiOkResponse({ type: AdminInvitationPublicUrlResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async getInvitationPublicUrl(
    @Param("invitationId") invitationId: string,
  ): Promise<AdminInvitationPublicUrlResponseDto> {
    return this.adminReadService.getInvitationPublicUrl(invitationId);
  }
}
