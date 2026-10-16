import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AdminRoles } from "../auth/admin-roles.decorator.js";
import { AdminRole } from "../generated/prisma/client.js";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { validationError } from "../auth/auth-errors.js";
import {
  AdminEventContentDto,
  EventContentVersionDto,
  PublicEventContentDto,
  SaveEventContentDto,
} from "./event-content.dto.js";
import { EventContentService } from "./event-content.service.js";

type Part = {
  type?: string;
  fieldname?: string;
  filename?: string;
  mimetype?: string;
  toBuffer?: () => Promise<Buffer>;
};
type UploadRequest = { parts?: () => AsyncIterable<Part> };
type Reply = { header: (name: string, value: string) => Reply };
function binary(
  reply: Reply,
  asset: { bytes: Uint8Array; kind: string; mimeType: string },
) {
  reply
    .header("Content-Type", asset.mimeType)
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "no-referrer")
    .header("Content-Security-Policy", "sandbox; default-src 'none'")
    .header(
      "Content-Disposition",
      asset.kind === "PDF"
        ? 'attachment; filename="parking-guide.pdf"'
        : 'inline; filename="parking-map.png"',
    );
  return Buffer.from(asset.bytes);
}
@ApiTags("Event content")
@AdminRoles(AdminRole.OWNER)
@ApiParam({ name: "eventId", format: "uuid", type: String })
@ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
@ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
@ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
@ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
@ApiConflictResponse({ type: ApiErrorEnvelopeDto })
@Controller("api/admin/event-content/:eventId")
export class AdminEventContentController {
  constructor(
    @Inject(EventContentService) private readonly content: EventContentService,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AdminEventContentDto })
  read(@Param("eventId") eventId: string) {
    return this.content.read(eventId);
  }
  @Put()
  @Header("Cache-Control", "no-store")
  @ApiBody({ type: SaveEventContentDto })
  @ApiOkResponse({ type: AdminEventContentDto })
  save(@Param("eventId") eventId: string, @Body() body: unknown) {
    return this.content.save(eventId, body);
  }
  @Post("publish")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiBody({ type: EventContentVersionDto })
  @ApiOkResponse({ type: AdminEventContentDto })
  publish(@Param("eventId") eventId: string, @Body() body: unknown) {
    return this.content.publish(eventId, body);
  }
  @Post("hide")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiBody({ type: EventContentVersionDto })
  @ApiOkResponse({ type: AdminEventContentDto })
  hide(@Param("eventId") eventId: string, @Body() body: unknown) {
    return this.content.hide(eventId, body);
  }
  @Post("assets")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AdminEventContentDto })
  @ApiConsumes("multipart/form-data")
  @ApiQuery({
    name: "expectedVersion",
    type: Number,
    minimum: 0,
    required: true,
  })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { file: { type: "string", format: "binary" } },
      required: ["file"],
    },
  })
  async upload(
    @Param("eventId") eventId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: UploadRequest,
  ) {
    if (
      Object.keys(query).length !== 1 ||
      typeof query.expectedVersion !== "string" ||
      !/^(0|[1-9]\d*)$/.test(query.expectedVersion) ||
      !Number.isSafeInteger(Number(query.expectedVersion))
    )
      validationError();
    let source:
      { buffer: Buffer; filename: string; mimetype: string } | undefined;
    if (!request.parts) validationError();
    try {
      for await (const part of request.parts()) {
        if (
          source ||
          part.type !== "file" ||
          part.fieldname !== "file" ||
          !part.toBuffer
        )
          validationError();
        source = {
          buffer: await part.toBuffer(),
          filename: part.filename ?? "",
          mimetype: part.mimetype ?? "",
        };
      }
    } catch {
      validationError();
    }
    if (!source) validationError();
    return this.content.upload(eventId, Number(query.expectedVersion), source);
  }
  @Get("assets/:assetId")
  @ApiParam({ name: "assetId", type: String, format: "uuid" })
  @ApiProduces("image/png", "application/pdf")
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async asset(
    @Param("eventId") eventId: string,
    @Param("assetId") assetId: string,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    return binary(reply, await this.content.adminAsset(eventId, assetId));
  }
  @Delete("assets/:assetId")
  @Header("Cache-Control", "no-store")
  @ApiParam({ name: "assetId", type: String, format: "uuid" })
  @ApiBody({ type: EventContentVersionDto })
  @ApiOkResponse({ type: AdminEventContentDto })
  remove(
    @Param("eventId") eventId: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    return this.content.removeAsset(eventId, assetId, body);
  }
}
@ApiTags("Public event content")
@ApiParam({
  name: "publicCredential",
  schema: { type: "string", minLength: 43, maxLength: 43 },
})
@ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
@Controller("api/public/invitations/:publicCredential")
export class PublicEventContentController {
  constructor(
    @Inject(EventContentService) private readonly content: EventContentService,
  ) {}
  @Get("venue-content")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: PublicEventContentDto })
  read(@Param("publicCredential") credential: string) {
    return this.content.publicContent(credential);
  }
  @Get("venue-assets/:assetId")
  @ApiParam({ name: "assetId", type: String, format: "uuid" })
  @ApiProduces("image/png", "application/pdf")
  @ApiOkResponse({ schema: { type: "string", format: "binary" } })
  async asset(
    @Param("publicCredential") credential: string,
    @Param("assetId") assetId: string,
    @Res({ passthrough: true }) reply: Reply,
  ) {
    return binary(reply, await this.content.publicAsset(credential, assetId));
  }
}
