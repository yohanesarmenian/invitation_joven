import { createHash } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import { parse as parseCsvSync } from "csv-parse/sync";
import ExcelJS from "exceljs";
import type { Prisma } from "../generated/prisma/client.js";
import {
  GuestImportPreviewStatus,
  GuestImportSourceFormat,
  InviteeCategory,
} from "../generated/prisma/client.js";
import { validationError } from "../auth/auth-errors.js";
import {
  normalizeAdminCreateInvitationInput,
  type NormalizedCreateInput,
} from "../admin/admin-mutation.service.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  GuestImportIssueCode,
  GuestImportIssueDto,
  GuestImportPreviewRowDto,
  GuestImportPreviewSummaryDto,
  GuestImportValidateResponseDto,
} from "./dto/guest-import.dto.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 500;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const BASE_HEADERS = [
  "displayName",
  "greetingName",
  "allowPlusOne",
  "maxAdditionalChildren",
  "rsvpDeadlineLocal",
  "notes",
  "invitees",
] as const;

type SourceFormat = GuestImportSourceFormat;

type RawRow = {
  cells: unknown[];
  rowNumber: number;
};

type ParsedImportRow = {
  eventSlugs: string[];
  input: NormalizedCreateInput;
};

type InternalRow = GuestImportPreviewRowDto & {
  normalized?: ParsedImportRow;
};

type UploadSource = {
  buffer: Buffer;
  filename: string;
  mimetype: string;
};

type ValidatePreviewInput = {
  createdByAdminUserId: string;
  source: UploadSource;
};

type HeaderPlan = {
  eventSlugs: string[];
  headers: string[];
};

function fileIssue(): never {
  validationError();
}

function issue(
  rowNumber: number,
  column: string | null,
  field: string | null,
  code: GuestImportIssueCode,
  message: string,
): GuestImportIssueDto {
  return { code, column, field, message, rowNumber };
}

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function isBlankRecord(cells: readonly unknown[]): boolean {
  return cells.every((cell) => isBlankCell(cell));
}

function sanitizeFilename(filename: string): string {
  const basename = path
    .basename(filename.replaceAll("\\", "/"))
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);

      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .trim();

  return (basename.length === 0 ? "upload" : basename).slice(0, 160);
}

function sourceDigest(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function detectFormat(filename: string, buffer: Buffer): SourceFormat {
  const extension = path.extname(filename).toLowerCase();

  if ([".xls", ".xlsm", ".xlsb", ".zip"].includes(extension)) {
    fileIssue();
  }

  if (extension === ".csv") {
    return GuestImportSourceFormat.CSV;
  }

  if (extension === ".xlsx") {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      fileIssue();
    }

    return GuestImportSourceFormat.XLSX;
  }

  fileIssue();
}

function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fileIssue();
  }
}

function parseCsv(buffer: Buffer): RawRow[] {
  const text = decodeCsv(buffer);

  try {
    const records = parseCsvSync(text, {
      bom: true,
      delimiter: ",",
      quote: "\"",
      escape: "\"",
      relax_column_count: true,
      skip_empty_lines: false,
    }) as unknown[][];

    return records.map((record, index) => ({
      cells: record,
      rowNumber: index + 1,
    }));
  } catch {
    fileIssue();
  }
}

function xlsxCellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;

  if (
    value !== null &&
    typeof value === "object" &&
    ("formula" in value || "sharedFormula" in value)
  ) {
    fileIssue();
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    value !== null &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }

  return value;
}

async function parseXlsx(buffer: Buffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    fileIssue();
  }

  const worksheet = workbook.getWorksheet("Invitations");

  if (worksheet === undefined || worksheet.state === "hidden") {
    fileIssue();
  }

  if (Object.keys((worksheet as unknown as { _merges?: object })._merges ?? {}).length > 0) {
    fileIssue();
  }

  const headerRow = worksheet.getRow(1);
  let headerWidth = 0;
  headerRow.eachCell({ includeEmpty: false }, (_cell, columnNumber) => {
    headerWidth = Math.max(headerWidth, columnNumber);
  });

  const rows: RawRow[] = [
    {
      cells: Array.from({ length: headerWidth }, (_value, index) =>
        xlsxCellValue(headerRow.getCell(index + 1)),
      ),
      rowNumber: 1,
    },
  ];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    let width = headerWidth;
    row.eachCell({ includeEmpty: false }, (_cell, columnNumber) => {
      width = Math.max(width, columnNumber);
    });

    const cells = Array.from({ length: width }, (_value, index) =>
      xlsxCellValue(row.getCell(index + 1)),
    );

    if (!isBlankRecord(cells)) {
      rows.push({ cells, rowNumber });
    }
  });

  return rows;
}

function validateHeader(header: RawRow): HeaderPlan {
  const headers = header.cells.map((cell, index) => {
    if (typeof cell !== "string") {
      fileIssue();
    }

    return index === 0 ? cell.replace(/^\uFEFF/, "") : cell;
  });

  if (headers.length < BASE_HEADERS.length) {
    fileIssue();
  }

  for (const [index, baseHeader] of BASE_HEADERS.entries()) {
    if (headers[index] !== baseHeader) {
      fileIssue();
    }
  }

  if (new Set(headers).size !== headers.length) {
    fileIssue();
  }

  const eventSlugs = headers.slice(BASE_HEADERS.length).map((headerName) => {
    if (!headerName.startsWith("event:") || headerName.length <= "event:".length) {
      fileIssue();
    }

    return headerName.slice("event:".length);
  });

  return { eventSlugs, headers };
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  return value.trim();
}

function parseText(
  row: InternalRow,
  cells: readonly unknown[],
  columnIndex: number,
  field: string,
  required: boolean,
): string | null {
  const column = BASE_HEADERS[columnIndex] ?? null;
  const value = textValue(cells[columnIndex]);

  if (value === null) {
    row.errors.push(
      issue(row.rowNumber, column, field, "INVALID_VALUE", "Expected text."),
    );
    return null;
  }

  if (value.length === 0) {
    if (required) {
      row.errors.push(
        issue(row.rowNumber, column, field, "REQUIRED_FIELD", "Required field."),
      );
    }

    return null;
  }

  return value;
}

function parseBoolean(
  row: InternalRow,
  value: unknown,
  column: string,
  field: string,
  blankAsFalse: boolean,
): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === null || value === undefined || String(value).trim() === "") {
    if (blankAsFalse) {
      return false;
    }

    row.errors.push(
      issue(row.rowNumber, column, field, "REQUIRED_FIELD", "Required field."),
    );
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  row.errors.push(
    issue(row.rowNumber, column, field, "INVALID_VALUE", "Invalid boolean."),
  );
  return null;
}

function parseInteger(row: InternalRow, value: unknown): number | null {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  } else if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    const parsed = Number(value.trim());

    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  row.errors.push(
    issue(
      row.rowNumber,
      "maxAdditionalChildren",
      "maxAdditionalChildren",
      "INVALID_VALUE",
      "Invalid non-negative integer.",
    ),
  );
  return null;
}

function parseJakartaDeadline(row: InternalRow, value: unknown): Date | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  if (typeof value === "number" || value instanceof Date) {
    fileIssue();
  }

  if (typeof value !== "string") {
    row.errors.push(
      issue(
        row.rowNumber,
        "rsvpDeadlineLocal",
        "rsvpDeadlineAt",
        "INVALID_DATE",
        "Expected text date in YYYY-MM-DD HH:mm.",
      ),
    );
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(
    value.trim(),
  );

  if (match === null) {
    row.errors.push(
      issue(
        row.rowNumber,
        "rsvpDeadlineLocal",
        "rsvpDeadlineAt",
        "INVALID_DATE",
        "Invalid date format.",
      ),
    );
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    row.errors.push(
      issue(
        row.rowNumber,
        "rsvpDeadlineLocal",
        "rsvpDeadlineAt",
        "INVALID_DATE",
        "Invalid calendar date.",
      ),
    );
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute));
}

function parseInvitees(row: InternalRow, value: unknown) {
  if (typeof value !== "string") {
    row.errors.push(
      issue(row.rowNumber, "invitees", "invitees", "INVALID_JSON", "Invalid JSON."),
    );
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    row.errors.push(
      issue(row.rowNumber, "invitees", "invitees", "INVALID_JSON", "Invalid JSON."),
    );
    return [];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    row.errors.push(
      issue(
        row.rowNumber,
        "invitees",
        "invitees",
        "INVALID_INVITEE",
        "At least one invitee is required.",
      ),
    );
    return [];
  }

  return parsed.map((invitee) => {
    if (
      typeof invitee !== "object" ||
      invitee === null ||
      Array.isArray(invitee)
    ) {
      row.errors.push(
        issue(row.rowNumber, "invitees", "invitees", "INVALID_INVITEE", "Invalid invitee."),
      );
      return null;
    }

    const keys = Object.keys(invitee);
    const allowed = new Set(["fullName", "category", "label"]);

    if (keys.some((key) => !allowed.has(key))) {
      row.errors.push(
        issue(
          row.rowNumber,
          "invitees",
          "invitees",
          "INVALID_INVITEE",
          "Invitee contains unsupported field.",
        ),
      );
      return null;
    }

    const item = invitee as Record<string, unknown>;
    const fullName =
      typeof item.fullName === "string" ? item.fullName.trim() : "";
    const category =
      typeof item.category === "string" ? item.category.trim().toUpperCase() : "";
    const label =
      item.label === undefined || item.label === null
        ? null
        : typeof item.label === "string"
          ? item.label.trim() || null
          : undefined;

    if (
      fullName.length === 0 ||
      (category !== InviteeCategory.ADULT && category !== InviteeCategory.CHILD) ||
      label === undefined
    ) {
      row.errors.push(
        issue(row.rowNumber, "invitees", "invitees", "INVALID_INVITEE", "Invalid invitee."),
      );
      return null;
    }

    return {
      category: category as InviteeCategory,
      fullName,
      label,
    };
  }).filter((invitee): invitee is NonNullable<typeof invitee> => invitee !== null);
}

function duplicateKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\p{White_Space}+/gu, " ").toLowerCase();
}

function summary(rows: readonly InternalRow[]): GuestImportPreviewSummaryDto {
  const errorRows = rows.filter((row) => row.errors.length > 0).length;
  const warningRows = rows.filter(
    (row) => row.errors.length === 0 && row.warnings.length > 0,
  ).length;
  const validRows = rows.length - errorRows;

  return {
    errorRows,
    totalRows: rows.length,
    validRows,
    warningRows,
  };
}

@Injectable()
export class GuestImportService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async validatePreview(
    input: ValidatePreviewInput,
  ): Promise<GuestImportValidateResponseDto> {
    const filename = sanitizeFilename(input.source.filename);

    if (input.source.buffer.length > MAX_UPLOAD_BYTES) {
      fileIssue();
    }

    const sourceFormat = detectFormat(filename, input.source.buffer);
    const parsedRows =
      sourceFormat === GuestImportSourceFormat.CSV
        ? parseCsv(input.source.buffer)
        : await parseXlsx(input.source.buffer);

    if (parsedRows.length === 0 || isBlankRecord(parsedRows[0]!.cells)) {
      fileIssue();
    }

    const headerPlan = validateHeader(parsedRows[0]!);
    const dataRows = parsedRows.slice(1).filter((row) => !isBlankRecord(row.cells));

    if (dataRows.length > MAX_IMPORT_ROWS) {
      fileIssue();
    }

    const events = await this.prisma.event.findMany({
      select: { id: true, isActive: true, slug: true },
      where: { slug: { in: headerPlan.eventSlugs } },
    });
    const eventsBySlug = new Map(events.map((event) => [event.slug, event]));

    const rows = dataRows.map((rawRow) =>
      this.parseRow(rawRow, headerPlan, eventsBySlug),
    );

    await this.addDuplicateWarnings(rows);

    const previewSummary = summary(rows);
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
    const storedRows = rows.map((row) => ({
      errors: row.errors,
      eventSlugs: row.normalized?.eventSlugs ?? [],
      input: row.normalized?.input
        ? {
            ...row.normalized.input,
            rsvpDeadlineAt: row.normalized.input.rsvpDeadlineAt?.toISOString() ?? null,
          }
        : null,
      parsed: row.parsed ?? null,
      rowNumber: row.rowNumber,
      status: row.status,
      warnings: row.warnings,
    }));

    const preview = await this.prisma.guestImportPreview.create({
      data: {
        createdByAdminUserId: input.createdByAdminUserId,
        expiresAt,
        normalizedRows: storedRows as unknown as Prisma.InputJsonValue,
        sanitizedSourceFilename: filename,
        sourceDigest: sourceDigest(input.source.buffer),
        sourceFormat,
        status: GuestImportPreviewStatus.PENDING,
        summary: previewSummary as unknown as Prisma.InputJsonValue,
      },
      select: { expiresAt: true, id: true },
    });

    return {
      expiresAt: preview.expiresAt.toISOString(),
      previewId: preview.id,
      rows: rows.map((row) => ({
        errors: row.errors,
        parsed: row.parsed,
        rowNumber: row.rowNumber,
        status: row.status,
        warnings: row.warnings,
      })),
      summary: previewSummary,
    };
  }

  private parseRow(
    rawRow: RawRow,
    headerPlan: HeaderPlan,
    eventsBySlug: ReadonlyMap<string, { id: string; isActive: boolean; slug: string }>,
  ): InternalRow {
    const row: InternalRow = {
      errors: [],
      parsed: undefined,
      rowNumber: rawRow.rowNumber,
      status: "VALID",
      warnings: [],
    };
    const cells = rawRow.cells;
    const displayName = parseText(row, cells, 0, "displayName", true);
    const greetingName = parseText(row, cells, 1, "greetingName", false);
    const allowPlusOne = parseBoolean(
      row,
      cells[2],
      "allowPlusOne",
      "allowPlusOne",
      false,
    );
    const maxAdditionalChildren = parseInteger(row, cells[3]);
    const rsvpDeadlineAt = parseJakartaDeadline(row, cells[4]);
    const notes = parseText(row, cells, 5, "notes", false);
    const invitees = parseInvitees(row, cells[6]);
    const eventIds: string[] = [];
    const selectedEventSlugs: string[] = [];

    for (const [index, slug] of headerPlan.eventSlugs.entries()) {
      const column = `event:${slug}`;
      const selected = parseBoolean(
        row,
        cells[BASE_HEADERS.length + index],
        column,
        "eventIds",
        true,
      );
      const event = eventsBySlug.get(slug);

      if (event === undefined) {
        row.errors.push(
          issue(
            row.rowNumber,
            column,
            "eventIds",
            "UNKNOWN_EVENT",
            "Unknown event slug.",
          ),
        );
        continue;
      }

      if (selected === true && !event.isActive) {
        row.errors.push(
          issue(
            row.rowNumber,
            column,
            "eventIds",
            "INACTIVE_EVENT",
            "Inactive event selected.",
          ),
        );
      }

      if (selected === true) {
        eventIds.push(event.id);
        selectedEventSlugs.push(slug);
      }
    }

    if (
      displayName !== null &&
      allowPlusOne !== null &&
      maxAdditionalChildren !== null &&
      row.errors.length === 0
    ) {
      try {
        row.normalized = {
          eventSlugs: selectedEventSlugs,
          input: normalizeAdminCreateInvitationInput({
            allowPlusOne,
            displayName,
            eventIds,
            greetingName,
            invitees,
            maxAdditionalChildren,
            notes,
            rsvpDeadlineAt: rsvpDeadlineAt?.toISOString() ?? null,
          }),
        };
        row.parsed = { displayName: row.normalized.input.displayName };
      } catch {
        row.errors.push(
          issue(
            row.rowNumber,
            null,
            null,
            "INVALID_VALUE",
            "Row failed invitation business validation.",
          ),
        );
      }
    }

    row.status =
      row.errors.length > 0
        ? "ERROR"
        : row.warnings.length > 0
          ? "VALID_WITH_WARNINGS"
          : "VALID";

    return row;
  }

  private async addDuplicateWarnings(rows: InternalRow[]): Promise<void> {
    const keys = rows
      .map((row) => row.normalized?.input.displayName)
      .filter((name): name is string => name !== undefined)
      .map(duplicateKey);
    const existing = await this.prisma.invitation.findMany({
      select: { displayName: true },
    });
    const existingKeys = new Set(existing.map((row) => duplicateKey(row.displayName)));
    const rowKeyCounts = new Map<string, number>();

    for (const key of keys) {
      rowKeyCounts.set(key, (rowKeyCounts.get(key) ?? 0) + 1);
    }

    for (const row of rows) {
      const displayName = row.normalized?.input.displayName;

      if (displayName === undefined || row.errors.length > 0) {
        continue;
      }

      const key = duplicateKey(displayName);

      if (existingKeys.has(key) || (rowKeyCounts.get(key) ?? 0) > 1) {
        row.warnings.push(
          issue(
            row.rowNumber,
            "displayName",
            "displayName",
            "POSSIBLE_DUPLICATE",
            "Possible duplicate household by normalized display name.",
          ),
        );
      }

      row.status = row.warnings.length > 0 ? "VALID_WITH_WARNINGS" : "VALID";
    }
  }
}
