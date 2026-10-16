import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { validationError } from "../auth/auth-errors.js";
import {
  buildAdminPageMetadata,
  parseAdminPagination,
} from "../common/admin-query.js";
import {
  reportKinds,
  type ReportKind,
  type ReportRowDto,
  type ReportSummaryDto,
  type ReportListDto,
} from "./report.dto.js";
import { csv } from "./csv.js";
type Filter = { archived: "exclude" | "include"; eventId: string | null };
type DatabaseRow = Omit<ReportRowDto, "checkedInAt"> & {
  checkedInAt: Date | null;
};
const EXPORT_LIMIT = 10_000;
function filter(
  query: Record<string, unknown>,
  allowed: readonly string[],
): Filter {
  if (Object.keys(query).some((key) => !allowed.includes(key)))
    validationError();
  const archived = query.archived ?? "exclude",
    eventId = query.eventId ?? null;
  if (archived !== "exclude" && archived !== "include") validationError();
  if (
    eventId !== null &&
    (typeof eventId !== "string" ||
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(eventId))
  )
    validationError();
  return { archived, eventId };
}
function kind(
  value: unknown,
  fallback: ReportKind | "SUMMARY",
  summary = false,
): ReportKind | "SUMMARY" {
  const selected = value ?? fallback;
  if (
    ![...reportKinds, ...(summary ? ["SUMMARY"] : [])].includes(
      selected as string,
    )
  )
    validationError();
  return selected as ReportKind | "SUMMARY";
}
const active = (f: Filter) =>
  f.archived === "include" ? Prisma.sql`TRUE` : Prisma.sql`i.status='ACTIVE'`;
const eventFilter = (f: Filter) =>
  f.eventId ? Prisma.sql`e.id=${f.eventId}::uuid` : Prisma.sql`TRUE`;

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async summary(query: Record<string, unknown>): Promise<ReportSummaryDto> {
    const f = filter(query, ["archived", "eventId"]);
    return this.prisma.$transaction((tx) => this.summaryIn(tx, f), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  private async summaryIn(
    tx: Prisma.TransactionClient,
    f: Filter,
  ): Promise<ReportSummaryDto> {
    const events = await tx.$queryRaw<ReportSummaryDto["events"]>(Prisma.sql`
      WITH expected AS (
        SELECT s.event_id, SUM(s.expected_attendee_count)::int AS people, COUNT(*)::int AS households,
          COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM checkin_records c WHERE c.invitation_id=i.id AND c.event_id=s.event_id))::int AS missing
        FROM rsvp_event_selections s JOIN rsvps r ON r.id=s.rsvp_id JOIN invitations i ON i.id=r.invitation_id
        WHERE r.status='ACCEPTED' AND s.attending AND ${active(f)} GROUP BY s.event_id
      ), actual AS (
        SELECT c.event_id,SUM(c.attendee_count)::int AS people,COUNT(*)::int AS households
        FROM checkin_records c JOIN invitations i ON i.id=c.invitation_id WHERE ${active(f)} GROUP BY c.event_id
      )
      SELECT e.id,e.name,e.is_active AS "isActive",COALESCE(x.people,0)::int AS "expectedAttendeeCount",COALESCE(x.households,0)::int AS "expectedHouseholds",
        COALESCE(a.people,0)::int AS "actualAttendeeCount",COALESCE(a.households,0)::int AS "checkedInHouseholds",COALESCE(x.missing,0)::int AS "notArrivedHouseholds"
      FROM events e LEFT JOIN expected x ON x.event_id=e.id LEFT JOIN actual a ON a.event_id=e.id
      WHERE ${eventFilter(f)} ORDER BY e.display_order ASC,e.id ASC
    `);
    return {
      generatedAt: new Date().toISOString(),
      archived: f.archived,
      events,
    };
  }
  private rowsSql(f: Filter, selected: ReportKind): Prisma.Sql {
    const shared = Prisma.sql`i.id AS "invitationId",i.display_name AS "displayName",i.status::text AS "invitationStatus",COALESCE(r.status::text,'PENDING') AS "rsvpStatus",r.dietary_notes AS "dietaryNotes",COALESCE((SELECT SUM(a.quantity)::int FROM rsvp_attendees a WHERE a.rsvp_id=r.id),0)::int AS "rsvpHouseholdSize"`;
    if (selected === "RSVP")
      return Prisma.sql`
      SELECT ${shared},NULL::uuid AS "eventId",NULL::text AS "eventName",NULL::int AS "expectedAttendeeCount",NULL::int AS "actualAttendeeCount",NULL::timestamptz AS "checkedInAt",NULL::text AS method,NULL::text AS "operatorEmail"
      FROM invitations i LEFT JOIN rsvps r ON r.invitation_id=i.id WHERE ${active(f)}
      AND ${f.eventId ? Prisma.sql`EXISTS (SELECT 1 FROM invitation_events ie WHERE ie.invitation_id=i.id AND ie.event_id=${f.eventId}::uuid)` : Prisma.sql`TRUE`}
    `;
    if (selected === "CHECKIN")
      return Prisma.sql`
      SELECT ${shared},e.id AS "eventId",e.name AS "eventName",s.expected_attendee_count AS "expectedAttendeeCount",c.attendee_count AS "actualAttendeeCount",c.checked_in_at AS "checkedInAt",c.method::text AS method,u.email AS "operatorEmail"
      FROM checkin_records c JOIN invitations i ON i.id=c.invitation_id JOIN events e ON e.id=c.event_id JOIN admin_users u ON u.id=c.confirmed_by_admin_user_id
      LEFT JOIN rsvps r ON r.invitation_id=i.id LEFT JOIN rsvp_event_selections s ON s.rsvp_id=r.id AND s.event_id=e.id
      WHERE ${active(f)} AND ${eventFilter(f)}
    `;
    return Prisma.sql`
      SELECT ${shared},e.id AS "eventId",e.name AS "eventName",s.expected_attendee_count AS "expectedAttendeeCount",NULL::int AS "actualAttendeeCount",NULL::timestamptz AS "checkedInAt",NULL::text AS method,NULL::text AS "operatorEmail"
      FROM rsvp_event_selections s JOIN rsvps r ON r.id=s.rsvp_id JOIN invitations i ON i.id=r.invitation_id JOIN events e ON e.id=s.event_id
      WHERE ${active(f)} AND ${eventFilter(f)} AND r.status='ACCEPTED' AND s.attending
      AND NOT EXISTS(SELECT 1 FROM checkin_records c WHERE c.invitation_id=i.id AND c.event_id=e.id)
    `;
  }
  private async readRows(
    tx: Prisma.TransactionClient,
    sql: Prisma.Sql,
    limit: number,
    offset = 0,
  ): Promise<ReportRowDto[]> {
    const rows = await tx.$queryRaw<DatabaseRow[]>(
      Prisma.sql`WITH report_rows AS (${sql}) SELECT * FROM report_rows ORDER BY "displayName" ASC,"invitationId" ASC,"eventId" ASC LIMIT ${limit} OFFSET ${offset}`,
    );
    return rows.map((row) => ({
      ...row,
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
    }));
  }
  async list(query: Record<string, unknown>): Promise<ReportListDto> {
    const f = filter(query, [
        "archived",
        "eventId",
        "kind",
        "page",
        "pageSize",
      ]),
      selected = kind(query.kind, "RSVP") as ReportKind,
      page = parseAdminPagination(query),
      sql = this.rowsSql(f, selected);
    return this.prisma.$transaction(
      async (tx) => {
        const totals = await tx.$queryRaw<Array<{ total: number }>>(
          Prisma.sql`WITH report_rows AS (${sql}) SELECT COUNT(*)::int AS total FROM report_rows`,
        );
        const items = await this.readRows(tx, sql, page.pageSize, page.skip);
        return {
          generatedAt: new Date().toISOString(),
          items,
          page: buildAdminPageMetadata(page, totals[0]?.total ?? 0),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async export(
    query: Record<string, unknown>,
  ): Promise<{ body: string; filename: string }> {
    const f = filter(query, ["archived", "eventId", "kind"]),
      selected = kind(query.kind, "SUMMARY", true);
    const body = await this.prisma.$transaction(
      async (tx) => {
        if (selected === "SUMMARY") {
          const data = await this.summaryIn(tx, f);
          return csv(
            [
              "eventId",
              "eventName",
              "isActive",
              "expectedAttendeeCount",
              "expectedHouseholds",
              "actualAttendeeCount",
              "checkedInHouseholds",
              "notArrivedHouseholds",
            ],
            data.events.map((e) => [
              e.id,
              e.name,
              e.isActive,
              e.expectedAttendeeCount,
              e.expectedHouseholds,
              e.actualAttendeeCount,
              e.checkedInHouseholds,
              e.notArrivedHouseholds,
            ]),
          );
        }
        const rows = await this.readRows(
          tx,
          this.rowsSql(f, selected),
          EXPORT_LIMIT + 1,
        );
        if (rows.length > EXPORT_LIMIT)
          throw new ConflictException({
            code: "REPORT_TOO_LARGE",
            message: "Filter the report to at most 10000 rows",
            details: null,
          });
        return csv(
          [
            "invitationId",
            "household",
            "invitationStatus",
            "rsvpStatus",
            "dietaryNotes",
            "rsvpHouseholdSize",
            "eventId",
            "eventName",
            "expectedAttendeeCount",
            "actualAttendeeCount",
            "checkedInAtUtc",
            "method",
            "operatorEmail",
          ],
          rows.map((r) => [
            r.invitationId,
            r.displayName,
            r.invitationStatus,
            r.rsvpStatus,
            r.dietaryNotes,
            r.rsvpHouseholdSize,
            r.eventId,
            r.eventName,
            r.expectedAttendeeCount,
            r.actualAttendeeCount,
            r.checkedInAt,
            r.method,
            r.operatorEmail,
          ]),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      body,
      filename: `wedding-report-${selected.toLowerCase().replaceAll("_", "-")}.csv`,
    };
  }
}
