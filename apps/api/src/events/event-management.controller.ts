import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBody,
  ApiOkResponse,
  ApiParam,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AdminRoles } from "../auth/admin-roles.decorator.js";
import { AdminRole } from "../generated/prisma/client.js";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import {
  EventFieldsDto,
  SaveEventDto,
  ManagedEventDto,
  ManagedEventsDto,
} from "./event-management.dto.js";
import { EventManagementService } from "./event-management.service.js";

@ApiTags("Event management")
@AdminRoles(AdminRole.OWNER)
@ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
@ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
@ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
@ApiConflictResponse({ type: ApiErrorEnvelopeDto })
@ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
@Controller("api/admin/event-management")
export class EventManagementController {
  constructor(
    @Inject(EventManagementService)
    private readonly events: EventManagementService,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ManagedEventsDto })
  list() {
    return this.events.list();
  }
  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiBody({ type: EventFieldsDto })
  @ApiOkResponse({ type: ManagedEventDto })
  create(@Body() body: unknown) {
    return this.events.create(body);
  }
  @Put(":eventId")
  @Header("Cache-Control", "no-store")
  @ApiParam({ name: "eventId", format: "uuid", type: String })
  @ApiBody({ type: SaveEventDto })
  @ApiOkResponse({ type: ManagedEventDto })
  save(@Param("eventId") id: string, @Body() body: unknown) {
    return this.events.save(id, body);
  }
}
