import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
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
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { AdminStaffService } from "./admin-staff.service.js";
import {
  AdminStaffDto,
  AdminStaffListResponseDto,
  AdminStaffProvisionResponseDto,
  CreateAdminStaffRequestDto,
  UpdateAdminStaffRequestDto,
  mapCreateAdminStaffRequest,
  mapUpdateAdminStaffRequest,
} from "./dto/admin-staff.dto.js";

@ApiTags("Admin Staff")
@Controller("api/admin/staff")
export class AdminStaffController {
  constructor(
    @Inject(AdminStaffService)
    private readonly staffService: AdminStaffService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List check-in staff accounts" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({
    enum: ["ACTIVE", "DISABLED"],
    name: "status",
    required: false,
  })
  @ApiOkResponse({ type: AdminStaffListResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  async listStaff(
    @Query() query: Record<string, unknown>,
  ): Promise<AdminStaffListResponseDto> {
    return this.staffService.listStaff(query);
  }

  @Post()
  @ApiOperation({ summary: "Provision a check-in staff account" })
  @ApiBody({ type: CreateAdminStaffRequestDto })
  @ApiCreatedResponse({ type: AdminStaffProvisionResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async createStaff(
    @Body() body: unknown,
  ): Promise<AdminStaffProvisionResponseDto> {
    return this.staffService.createStaff(mapCreateAdminStaffRequest(body));
  }

  @Patch(":staffId")
  @ApiOperation({ summary: "Update a check-in staff account status" })
  @ApiBody({ type: UpdateAdminStaffRequestDto })
  @ApiOkResponse({ type: AdminStaffDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async updateStaffStatus(
    @Param("staffId") staffId: string,
    @Body() body: unknown,
  ): Promise<AdminStaffDto> {
    return this.staffService.updateStaffStatus(
      staffId,
      mapUpdateAdminStaffRequest(body),
    );
  }

  @Post(":staffId/reset-password")
  @HttpCode(200)
  @ApiOperation({ summary: "Reset a check-in staff account password" })
  @ApiOkResponse({ type: AdminStaffProvisionResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiNotFoundResponse({ type: ApiErrorEnvelopeDto })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async resetStaffPassword(
    @Param("staffId") staffId: string,
  ): Promise<AdminStaffProvisionResponseDto> {
    return this.staffService.resetStaffPassword(staffId);
  }
}
