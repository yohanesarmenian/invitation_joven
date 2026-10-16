import { Controller, Get, Header, Inject, Query, Res } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
type ReportReply = { header: (name: string, value: string) => ReportReply };
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import { AdminRoles } from "../auth/admin-roles.decorator.js";
import { AdminRole } from "../generated/prisma/client.js";
import {
  ReportExportQueryDto,
  ReportFilterDto,
  ReportListDto,
  ReportListQueryDto,
  ReportSummaryDto,
} from "./report.dto.js";
import { ReportsService } from "./reports.service.js";
@ApiTags("Reports")
@AdminRoles(AdminRole.OWNER)
@ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
@ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
@ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
@Controller("api/admin/reports")
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}
  @Get("summary")
  @ApiQuery({ type: ReportFilterDto })
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ReportSummaryDto })
  summary(@Query() query: ReportFilterDto) {
    return this.reports.summary(query as Record<string, unknown>);
  }
  @Get("households")
  @ApiQuery({ type: ReportListQueryDto })
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: ReportListDto })
  list(@Query() query: ReportListQueryDto) {
    return this.reports.list(query as Record<string, unknown>);
  }
  @Get("export")
  @ApiQuery({ type: ReportExportQueryDto })
  @Header("Cache-Control", "no-store")
  @ApiProduces("text/csv")
  @ApiOkResponse({ schema: { type: "string" } })
  @ApiConflictResponse({ type: ApiErrorEnvelopeDto })
  async export(
    @Query() query: ReportExportQueryDto,
    @Res({ passthrough: true }) reply: ReportReply,
  ) {
    const result = await this.reports.export(query as Record<string, unknown>);
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      );
    return result.body;
  }
}
