import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { isInvitationNotAvailableError } from "../invitations/invitation-not-available.error.js";
import {
  mapSubmitPublicGuestMessageRequest,
  parseSubmissionId,
  SUBMISSION_ID_PATTERN,
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
    return this.withAvailableInvitation(() =>
      this.publicGuestMessageService.submitPublicGuestMessage(
        mapSubmitPublicGuestMessageRequest(publicCredential, body),
      ),
    );
  }

  @Get(":publicCredential/messages/receipt")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Verify one guest message receipt" })
  @ApiParam(PUBLIC_CREDENTIAL_PARAM)
  @ApiHeader({
    name: "x-message-submission-id",
    required: true,
    schema: { type: "string", format: "uuid", pattern: SUBMISSION_ID_PATTERN },
  })
  @ApiOkResponse({ type: PublicGuestMessageResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  readReceipt(
    @Param("publicCredential") publicCredential: string,
    @Headers("x-message-submission-id") submissionId: unknown,
  ): Promise<PublicGuestMessageResponseDto> {
    return this.withAvailableInvitation(() =>
      this.publicGuestMessageService.readReceipt(
        publicCredential,
        parseSubmissionId(submissionId),
      ),
    );
  }

  private async withAvailableInvitation(
    operation: () => Promise<PublicGuestMessageResponseDto>,
  ): Promise<PublicGuestMessageResponseDto> {
    try {
      return await operation();
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
