import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { isInvitationNotAvailableError } from "../invitations/invitation-not-available.error.js";
import {
  mapSubmitPublicGuestMessageRequest,
  PublicGuestMessageResponseDto,
  SubmitPublicGuestMessageRequestDto,
} from "./dto/public-guest-message.dto.js";
import { PublicGuestMessageService } from "./public-guest-message.service.js";

const PUBLIC_CREDENTIAL_PARAM = {
  name: "publicCredential",
  required: true,
  schema: {
    maxLength: 43,
    minLength: 43,
    pattern: "^[A-Za-z0-9_-]{43}$",
    type: "string",
  },
} as const;

@ApiTags("Public Guest Messages")
@Controller("api/public/invitations")
export class PublicGuestMessageController {
  constructor(
    @Inject(PublicGuestMessageService)
    private readonly publicGuestMessageService: PublicGuestMessageService,
  ) {}

  @Post(":publicCredential/messages")
  @ApiOperation({ summary: "Submit a public guest message" })
  @ApiParam(PUBLIC_CREDENTIAL_PARAM)
  @ApiBody({ type: SubmitPublicGuestMessageRequestDto })
  @ApiCreatedResponse({ type: PublicGuestMessageResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid request payload.",
    type: ApiErrorEnvelopeDto,
  })
  @ApiNotFoundResponse({
    description: "Invitation unavailable.",
    type: ApiErrorEnvelopeDto,
  })
  async submitPublicGuestMessage(
    @Param("publicCredential") publicCredential: string,
    @Body() body: unknown,
  ): Promise<PublicGuestMessageResponseDto> {
    try {
      return await this.publicGuestMessageService.submitPublicGuestMessage(
        mapSubmitPublicGuestMessageRequest(publicCredential, body),
      );
    } catch (error) {
      if (isInvitationNotAvailableError(error)) {
        throw new NotFoundException({
          code: error.code,
          details: error.details,
          message: error.message,
        });
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw error;
    }
  }
}
