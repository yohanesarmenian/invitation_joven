import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
} from "@nestjs/common";
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { PublicInvitationResponseDto } from "./dto/public-invitation.dto.js";
import { isInvitationNotAvailableError } from "./invitation-not-available.error.js";
import { PublicInvitationService } from "./public-invitation.service.js";

@ApiTags("Public Invitations")
@Controller("api/public/invitations")
export class PublicInvitationController {
  constructor(
    @Inject(PublicInvitationService)
    private readonly publicInvitationService: PublicInvitationService,
  ) {}

  @Get(":publicCredential")
  @ApiOperation({ summary: "Retrieve a public invitation" })
  @ApiParam({
    name: "publicCredential",
    required: true,
    schema: {
      maxLength: 43,
      minLength: 43,
      pattern: "^[A-Za-z0-9_-]{43}$",
      type: "string",
    },
  })
  @ApiOkResponse({ type: PublicInvitationResponseDto })
  @ApiNotFoundResponse({
    description: "Invitation unavailable.",
    type: ApiErrorEnvelopeDto,
  })
  async retrievePublicInvitation(
    @Param("publicCredential") publicCredential: string,
  ): Promise<PublicInvitationResponseDto> {
    try {
      return await this.publicInvitationService.retrievePublicInvitation(
        publicCredential,
      );
    } catch (error) {
      if (isInvitationNotAvailableError(error)) {
        throw new NotFoundException({
          code: error.code,
          details: error.details,
          message: error.message,
        });
      }

      throw error;
    }
  }
}
