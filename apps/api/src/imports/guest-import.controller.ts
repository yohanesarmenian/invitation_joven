import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { validationError } from "../auth/auth-errors.js";
import type { RequestWithAdminContext } from "../common/admin-security.guard.js";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import {
  GuestImportCommitRequestDto,
  GuestImportCommitResponseDto,
  GuestImportValidateResponseDto,
} from "./dto/guest-import.dto.js";
import { GuestImportService } from "./guest-import.service.js";

type MultipartPart = {
  fieldname?: string;
  file?: unknown;
  filename?: string;
  mimetype?: string;
  toBuffer?: () => Promise<Buffer>;
  type?: string;
};

type MultipartRequest = RequestWithAdminContext & {
  parts?: () => AsyncIterable<MultipartPart>;
};

@ApiTags("Admin")
@Controller("api/admin/imports/guest")
export class GuestImportController {
  constructor(
    @Inject(GuestImportService)
    private readonly guestImportService: GuestImportService,
  ) {}

  @Post("validate")
  @ApiOperation({ summary: "Validate guest import preview" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        file: {
          format: "binary",
          type: "string",
        },
      },
      required: ["file"],
      type: "object",
    },
  })
  @ApiCreatedResponse({ type: GuestImportValidateResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  async validateGuestImport(
    @Req() request: MultipartRequest,
  ): Promise<GuestImportValidateResponseDto> {
    const adminUserId = request.admin?.user.id;

    if (adminUserId === undefined) {
      throw new Error("Admin context missing after security guard.");
    }

    const parts = request.parts;

    if (parts === undefined) {
      validationError();
    }

    let file:
      | {
          buffer: Buffer;
          filename: string;
          mimetype: string;
        }
      | undefined;

    try {
      for await (const part of parts.call(request)) {
        if (part.type !== "file") {
          validationError();
        }

        if (part.fieldname !== "file" || typeof part.toBuffer !== "function") {
          validationError();
        }

        if (file !== undefined) {
          validationError();
        }

        file = {
          buffer: await part.toBuffer(),
          filename: part.filename ?? "upload",
          mimetype: part.mimetype ?? "",
        };
      }
    } catch {
      validationError();
    }

    if (file === undefined) {
      validationError();
    }

    return this.guestImportService.validatePreview({
      createdByAdminUserId: adminUserId,
      source: file,
    });
  }

  @Post("commit")
  @HttpCode(200)
  @ApiOperation({ summary: "Commit guest import preview" })
  @ApiBody({ type: GuestImportCommitRequestDto })
  @ApiOkResponse({ type: GuestImportCommitResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async commitGuestImport(
    @Req() request: RequestWithAdminContext,
    @Body() body: unknown,
  ): Promise<GuestImportCommitResponseDto> {
    const adminUserId = request.admin?.user.id;

    if (adminUserId === undefined) {
      throw new Error("Admin context missing after security guard.");
    }

    return this.guestImportService.commitPreview({
      body,
      committedByAdminUserId: adminUserId,
    });
  }
}
