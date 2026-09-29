import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { PublicInvitationResponseDto } from "./dto/public-invitation.dto.js";
import {
  mapSubmitPublicRsvpRequest,
  PublicRsvpMutationResponseDto,
  PublicRsvpReadResponseDto,
  SubmitPublicRsvpRequestDto,
} from "./dto/public-rsvp.dto.js";
import { isInvitationNotAvailableError } from "./invitation-not-available.error.js";
import { PublicInvitationService } from "./public-invitation.service.js";
import { isPublicRsvpDomainError } from "./public-rsvp.errors.js";
import { PublicRsvpService } from "./public-rsvp.service.js";

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

@ApiTags("Public Invitations")
@Controller("api/public/invitations")
export class PublicInvitationController {
  constructor(
    @Inject(PublicInvitationService)
    private readonly publicInvitationService: PublicInvitationService,
    @Inject(PublicRsvpService)
    private readonly publicRsvpService: PublicRsvpService,
  ) {}

  @Get(":publicCredential")
  @ApiOperation({ summary: "Retrieve a public invitation" })
  @ApiParam(PUBLIC_CREDENTIAL_PARAM)
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

  @Get(":publicCredential/rsvp")
  @ApiOperation({ summary: "Retrieve public RSVP state" })
  @ApiParam(PUBLIC_CREDENTIAL_PARAM)
  @ApiOkResponse({ type: PublicRsvpReadResponseDto })
  @ApiNotFoundResponse({
    description: "Invitation unavailable.",
    type: ApiErrorEnvelopeDto,
  })
  async retrievePublicRsvp(
    @Param("publicCredential") publicCredential: string,
  ): Promise<PublicRsvpReadResponseDto> {
    try {
      return await this.publicRsvpService.retrievePublicRsvp(publicCredential);
    } catch (error) {
      this.rethrowPublicRsvpError(error);
    }
  }

  @Put(":publicCredential/rsvp")
  @ApiOperation({ summary: "Create or update public RSVP" })
  @ApiParam(PUBLIC_CREDENTIAL_PARAM)
  @ApiBody({ type: SubmitPublicRsvpRequestDto })
  @ApiOkResponse({ type: PublicRsvpMutationResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid request payload.",
    type: ApiErrorEnvelopeDto,
  })
  @ApiNotFoundResponse({
    description: "Invitation unavailable.",
    type: ApiErrorEnvelopeDto,
  })
  @ApiConflictResponse({
    description: "RSVP version conflict.",
    type: ApiErrorEnvelopeDto,
  })
  @ApiUnprocessableEntityResponse({
    description: "RSVP domain validation failed.",
    type: ApiErrorEnvelopeDto,
  })
  async submitPublicRsvp(
    @Param("publicCredential") publicCredential: string,
    @Body() body: unknown,
  ): Promise<PublicRsvpMutationResponseDto> {
    try {
      return await this.publicRsvpService.submitPublicRsvp(
        mapSubmitPublicRsvpRequest(publicCredential, body),
      );
    } catch (error) {
      this.rethrowPublicRsvpError(error);
    }
  }

  private rethrowPublicRsvpError(error: unknown): never {
    if (isInvitationNotAvailableError(error)) {
      throw new NotFoundException({
        code: error.code,
        details: error.details,
        message: error.message,
      });
    }

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

    if (error instanceof BadRequestException) {
      throw error;
    }

    throw error;
  }
}
