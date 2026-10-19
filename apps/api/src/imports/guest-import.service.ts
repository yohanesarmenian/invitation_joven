import { createHash } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { parse as parseCsvSync } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { Prisma } from "../generated/prisma/client.js";
import {
  GuestImportStatus,
  GuestImportPreviewStatus,
  GuestImportSourceFormat,
  InviteeCategory,
} from "../generated/prisma/client.js";
import { notFound, validationError } from "../auth/auth-errors.js";
import {
  createAdminInvitationGraph,
  normalizeAdminCreateInvitationInput,
  type NormalizedCreateInput,
} from "../admin/admin-mutation.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { CredentialService } from "../security/credential.service.js";
import type {
  GuestImportCommitResponseDto,
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

type ParsedDeadline = {
  at: Date | null;
  local: string | null;
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

type CommitPreviewInput = {
  body: unknown;
  committedByAdminUserId: string;
};

type HeaderPlan = {
  eventSlugs: string[];
  headers: string[];
};

type StoredPreviewRow = {
  errors: GuestImportIssueDto[];
  eventSlugs: string[];
  input: StoredCreateInput | null;
  parsed: GuestImportPreviewRowDto["parsed"] | null;
  rowNumber: number;
  status: GuestImportPreviewRowDto["status"];
  warnings: GuestImportIssueDto[];
};

type StoredCreateInput = Omit<NormalizedCreateInput, "rsvpDeadlineAt"> & {
  rsvpDeadlineAt: string | null;
};

type NormalizedCommitRequest = {
  acknowledgedWarningRowNumbers: number[];
  commitFingerprint: string;
  includeRowNumbers: number[];
  previewId: string;
};

type LockedPreviewRow = {
  committedBatchId: string | null;
  commitFingerprint: string | null;
  createdByAdminUserId: string;
  expiresAt: Date;
  id: string;
  normalizedRows: Prisma.JsonValue;
  sanitizedSourceFilename: string;
  sourceFormat: GuestImportSourceFormat;
  status: GuestImportPreviewStatus;
  summary: Prisma.JsonValue;
};

type BatchReceipt = GuestImportCommitResponseDto["importBatch"];

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const COMMIT_FIELDS = new Set([
  "previewId",
  "includeRowNumbers",
  "acknowledgedWarningRowNumbers",
]);

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      validationError();
    }
  }
}

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    validationError();
  }
}

function normalizeRowNumberArray(
  value: unknown,
  allowEmpty: boolean,
): number[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    validationError();
  }

  const rowNumbers = value.map((rowNumber) => {
    if (
      typeof rowNumber !== "number" ||
      !Number.isSafeInteger(rowNumber) ||
      rowNumber < 1
    ) {
      validationError();
    }

    return rowNumber;
  });

  if (new Set(rowNumbers).size !== rowNumbers.length) {
    validationError();
  }

  return rowNumbers;
}

function sortedUniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function normalizeCommitRequest(body: unknown): NormalizedCommitRequest {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, COMMIT_FIELDS);

  if (
    !Object.hasOwn(body, "previewId") ||
    !Object.hasOwn(body, "includeRowNumbers") ||
    !Object.hasOwn(body, "acknowledgedWarningRowNumbers")
  ) {
    validationError();
  }

  if (typeof body.previewId !== "string") {
    validationError();
  }

  assertUuid(body.previewId);
  const includeRowNumbers = normalizeRowNumberArray(
    body.includeRowNumbers,
    false,
  );
  const acknowledgedWarningRowNumbers = normalizeRowNumberArray(
    body.acknowledgedWarningRowNumbers,
    true,
  );
  const canonical = JSON.stringify({
    acknowledgedWarningRowNumbers: sortedUniqueNumbers(
      acknowledgedWarningRowNumbers,
    ),
    includeRowNumbers: sortedUniqueNumbers(includeRowNumbers),
    previewId: body.previewId,
  });
  const commitFingerprint = createHash("sha256")
    .update(canonical)
    .digest("hex");

  return {
    acknowledgedWarningRowNumbers,
    commitFingerprint,
    includeRowNumbers,
    previewId: body.previewId,
  };
}

function importConflict(code: string, message: string): never {
  throw new ConflictException({
    code,
    details: null,
    message,
  });
}

function stalePreview(): never {
  importConflict("IMPORT_PREVIEW_STALE", "Import preview is stale.");
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
      quote: '"',
      escape: '"',
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

  if (
    Object.keys((worksheet as unknown as { _merges?: object })._merges ?? {})
      .length > 0
  ) {
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
    if (
      !headerName.startsWith("event:") ||
      headerName.length <= "event:".length
    ) {
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
        issue(
          row.rowNumber,
          column,
          field,
          "REQUIRED_FIELD",
          "Required field.",
        ),
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

function parseJakartaDeadline(
  row: InternalRow,
  value: unknown,
): ParsedDeadline {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { at: null, local: null };
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
    return { at: null, local: null };
  }

  const local = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(local);

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
    return { at: null, local: null };
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
    return { at: null, local: null };
  }

  return {
    at: new Date(Date.UTC(year, month - 1, day, hour - 7, minute)),
    local,
  };
}

function parseInvitees(row: InternalRow, value: unknown) {
  if (typeof value !== "string") {
    row.errors.push(
      issue(
        row.rowNumber,
        "invitees",
        "invitees",
        "INVALID_JSON",
        "Invalid JSON.",
      ),
    );
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    row.errors.push(
      issue(
        row.rowNumber,
        "invitees",
        "invitees",
        "INVALID_JSON",
        "Invalid JSON.",
      ),
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

  return parsed
    .map((invitee) => {
      if (
        typeof invitee !== "object" ||
        invitee === null ||
        Array.isArray(invitee)
      ) {
        row.errors.push(
          issue(
            row.rowNumber,
            "invitees",
            "invitees",
            "INVALID_INVITEE",
            "Invalid invitee.",
          ),
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
        typeof item.category === "string"
          ? item.category.trim().toUpperCase()
          : "";
      const label =
        item.label === undefined || item.label === null
          ? null
          : typeof item.label === "string"
            ? item.label.trim() || null
            : undefined;

      if (
        fullName.length === 0 ||
        (category !== InviteeCategory.ADULT &&
          category !== InviteeCategory.CHILD) ||
        label === undefined
      ) {
        row.errors.push(
          issue(
            row.rowNumber,
            "invitees",
            "invitees",
            "INVALID_INVITEE",
            "Invalid invitee.",
          ),
        );
        return null;
      }

      return {
        category: category as InviteeCategory,
        fullName,
        label,
      };
    })
    .filter(
      (invitee): invitee is NonNullable<typeof invitee> => invitee !== null,
    );
}

function duplicateKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\p{White_Space}+/gu, " ")
    .toLowerCase();
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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService)
    private readonly credentialService: CredentialService,
  ) {}

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
    const dataRows = parsedRows
      .slice(1)
      .filter((row) => !isBlankRecord(row.cells));

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
            rsvpDeadlineAt:
              row.normalized.input.rsvpDeadlineAt?.toISOString() ?? null,
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

  async commitPreview(
    input: CommitPreviewInput,
  ): Promise<GuestImportCommitResponseDto> {
    assertUuid(input.committedByAdminUserId);
    const request = normalizeCommitRequest(input.body);

    const importBatch = await this.prisma.$transaction(
      async (tx) => {
        const preview = await this.lockPreview(tx, request.previewId);

        if (preview.createdByAdminUserId !== input.committedByAdminUserId) {
          notFound();
        }

        if (preview.status === GuestImportPreviewStatus.COMMITTED) {
          if (
            preview.commitFingerprint === request.commitFingerprint &&
            preview.committedBatchId !== null
          ) {
            return this.readBatchReceipt(tx, preview.committedBatchId);
          }

          importConflict(
            "IMPORT_PREVIEW_ALREADY_COMMITTED",
            "Import preview has already been committed.",
          );
        }

        if (preview.status !== GuestImportPreviewStatus.PENDING) {
          stalePreview();
        }

        if (preview.expiresAt.getTime() <= Date.now()) {
          importConflict(
            "IMPORT_PREVIEW_EXPIRED",
            "Import preview has expired.",
          );
        }

        const rows = this.parseStoredRows(preview.normalizedRows);
        const selectedRows = this.selectRows(rows, request);
        const preparedRows = await this.revalidateSelectedRows(
          tx,
          rows,
          selectedRows,
          request.acknowledgedWarningRowNumbers,
        );
        const createdInviteeCount = preparedRows.reduce(
          (total, row) => total + row.input.invitees.length,
          0,
        );
        const warningCount = selectedRows.filter(
          (row) => row.warnings.length > 0,
        ).length;

        for (const row of preparedRows) {
          await createAdminInvitationGraph(
            tx,
            this.credentialService,
            row.input,
          );
        }

        const batch = await tx.guestImportBatch.create({
          data: {
            committedByAdminUserId: input.committedByAdminUserId,
            createdInvitationCount: preparedRows.length,
            createdInviteeCount,
            errorCount: 0,
            rowCount: preparedRows.length,
            sourceFilename: preview.sanitizedSourceFilename,
            sourceFormat: preview.sourceFormat,
            status: GuestImportStatus.COMMITTED,
            summary: {
              acknowledgedWarningRowNumbers: sortedUniqueNumbers(
                request.acknowledgedWarningRowNumbers,
              ),
              committedRowNumbers: preparedRows.map((row) => row.rowNumber),
              createdInvitationCount: preparedRows.length,
              createdInviteeCount,
              errorCount: 0,
              sourceSummary: preview.summary,
              warningCount,
            } satisfies Prisma.InputJsonObject,
            warningCount,
          },
          select: {
            createdInvitationCount: true,
            createdInviteeCount: true,
            id: true,
            status: true,
            warningCount: true,
          },
        });

        await tx.guestImportPreview.update({
          data: {
            commitFingerprint: request.commitFingerprint,
            committedBatchId: batch.id,
            normalizedRows: [] as unknown as Prisma.InputJsonValue,
            status: GuestImportPreviewStatus.COMMITTED,
          },
          where: { id: preview.id },
        });

        return this.mapBatchReceipt(batch);
      },
      {
        maxWait: 5000,
        timeout: 60000,
      },
    );

    return { importBatch };
  }

  private async lockPreview(
    tx: Prisma.TransactionClient,
    previewId: string,
  ): Promise<LockedPreviewRow> {
    const rows = await tx.$queryRaw<LockedPreviewRow[]>`
      SELECT
        "id",
        "created_by_admin_user_id" AS "createdByAdminUserId",
        "committed_batch_id" AS "committedBatchId",
        "source_format"::text AS "sourceFormat",
        "sanitized_source_filename" AS "sanitizedSourceFilename",
        "normalized_rows" AS "normalizedRows",
        "summary",
        "status"::text AS "status",
        "commit_fingerprint" AS "commitFingerprint",
        "expires_at" AS "expiresAt"
      FROM "guest_import_previews"
      WHERE "id" = ${previewId}::uuid
      FOR UPDATE
    `;
    const preview = rows[0];

    if (preview === undefined) {
      notFound();
    }

    return preview;
  }

  private async readBatchReceipt(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<BatchReceipt> {
    const batch = await tx.guestImportBatch.findUnique({
      select: {
        createdInvitationCount: true,
        createdInviteeCount: true,
        id: true,
        status: true,
        warningCount: true,
      },
      where: { id: batchId },
    });

    if (batch === null) {
      throw new Error("Committed import preview is missing its batch receipt.");
    }

    return this.mapBatchReceipt(batch);
  }

  private parseStoredRows(value: Prisma.JsonValue): StoredPreviewRow[] {
    if (!Array.isArray(value)) {
      stalePreview();
    }

    return value.map((row) => this.parseStoredRow(row));
  }

  private parseStoredRow(value: Prisma.JsonValue): StoredPreviewRow {
    if (!isPlainObject(value)) {
      stalePreview();
    }

    const rowNumber = value.rowNumber;
    const status = value.status;
    const errors = value.errors;
    const warnings = value.warnings;
    const eventSlugs = value.eventSlugs;
    const input = value.input;

    if (
      typeof rowNumber !== "number" ||
      !Number.isSafeInteger(rowNumber) ||
      rowNumber < 1 ||
      (status !== "VALID" &&
        status !== "VALID_WITH_WARNINGS" &&
        status !== "ERROR") ||
      !Array.isArray(errors) ||
      !Array.isArray(warnings) ||
      !Array.isArray(eventSlugs) ||
      !eventSlugs.every((slug) => typeof slug === "string")
    ) {
      stalePreview();
    }

    return {
      errors: errors as unknown as GuestImportIssueDto[],
      eventSlugs,
      input: input === null ? null : this.parseStoredCreateInput(input),
      parsed:
        value.parsed === null || value.parsed === undefined
          ? null
          : (value.parsed as unknown as GuestImportPreviewRowDto["parsed"]),
      rowNumber,
      status,
      warnings: warnings as unknown as GuestImportIssueDto[],
    };
  }

  private parseStoredCreateInput(value: unknown): StoredCreateInput {
    if (!isPlainObject(value)) {
      stalePreview();
    }

    const normalized = normalizeAdminCreateInvitationInput(value);

    return {
      ...normalized,
      rsvpDeadlineAt: normalized.rsvpDeadlineAt?.toISOString() ?? null,
    };
  }

  private selectRows(
    rows: readonly StoredPreviewRow[],
    request: NormalizedCommitRequest,
  ): StoredPreviewRow[] {
    const rowsByNumber = new Map(rows.map((row) => [row.rowNumber, row]));
    const acknowledgedRows = new Set(request.acknowledgedWarningRowNumbers);

    for (const rowNumber of request.acknowledgedWarningRowNumbers) {
      const row = rowsByNumber.get(rowNumber);

      if (row === undefined || row.warnings.length === 0) {
        validationError();
      }
    }

    return request.includeRowNumbers.map((rowNumber) => {
      const row = rowsByNumber.get(rowNumber);

      if (row === undefined || row.input === null || row.errors.length > 0) {
        validationError();
      }

      if (row.warnings.length > 0 && !acknowledgedRows.has(row.rowNumber)) {
        validationError();
      }

      return row;
    });
  }

  private async revalidateSelectedRows(
    tx: Prisma.TransactionClient,
    allRows: readonly StoredPreviewRow[],
    selectedRows: readonly StoredPreviewRow[],
    acknowledgedWarningRowNumbers: readonly number[],
  ): Promise<Array<{ input: NormalizedCreateInput; rowNumber: number }>> {
    const selectedSlugs = [
      ...new Set(selectedRows.flatMap((row) => row.eventSlugs)),
    ];
    if (selectedSlugs.length > 0) {
      await tx.$queryRaw`SELECT id FROM events WHERE slug IN (${Prisma.join(selectedSlugs)}) ORDER BY id FOR SHARE`;
    }
    const events = await tx.event.findMany({
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: { id: true, isActive: true, slug: true },
      where: { slug: { in: selectedSlugs } },
    });
    const eventsBySlug = new Map(events.map((event) => [event.slug, event]));
    const acknowledgedRows = new Set(acknowledgedWarningRowNumbers);
    const allValidKeys = allRows
      .map((row) => row.input?.displayName)
      .filter((displayName): displayName is string => displayName !== undefined)
      .map(duplicateKey);
    const rowKeyCounts = new Map<string, number>();

    for (const key of allValidKeys) {
      rowKeyCounts.set(key, (rowKeyCounts.get(key) ?? 0) + 1);
    }

    const existingInvitations = await tx.invitation.findMany({
      select: { displayName: true },
    });
    const existingKeys = new Set(
      existingInvitations.map((row) => duplicateKey(row.displayName)),
    );

    return selectedRows.map((row) => {
      if (row.input === null) {
        stalePreview();
      }

      const eventIds = row.eventSlugs.map((slug) => {
        const event = eventsBySlug.get(slug);

        if (event === undefined || !event.isActive) {
          stalePreview();
        }

        return event.id;
      });

      const key = duplicateKey(row.input.displayName);
      const hasDuplicateWarning = row.warnings.some(
        (warning) => warning.code === "POSSIBLE_DUPLICATE",
      );
      const hasCurrentDuplicate =
        existingKeys.has(key) || (rowKeyCounts.get(key) ?? 0) > 1;

      if (
        hasCurrentDuplicate &&
        (!hasDuplicateWarning || !acknowledgedRows.has(row.rowNumber))
      ) {
        stalePreview();
      }

      try {
        return {
          input: normalizeAdminCreateInvitationInput({
            ...row.input,
            eventIds,
            rsvpDeadlineAt: row.input.rsvpDeadlineAt,
          }),
          rowNumber: row.rowNumber,
        };
      } catch {
        stalePreview();
      }
    });
  }

  private mapBatchReceipt(batch: {
    createdInvitationCount: number;
    createdInviteeCount: number;
    id: string;
    status: GuestImportStatus;
    warningCount: number;
  }): BatchReceipt {
    return {
      createdInvitationCount: batch.createdInvitationCount,
      createdInviteeCount: batch.createdInviteeCount,
      id: batch.id,
      status: batch.status,
      warningCount: batch.warningCount,
    };
  }

  private parseRow(
    rawRow: RawRow,
    headerPlan: HeaderPlan,
    eventsBySlug: ReadonlyMap<
      string,
      { id: string; isActive: boolean; slug: string }
    >,
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
    const rsvpDeadline = parseJakartaDeadline(row, cells[4]);
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
            rsvpDeadlineAt: rsvpDeadline.at?.toISOString() ?? null,
          }),
        };
        row.parsed = {
          allowPlusOne: row.normalized.input.allowPlusOne,
          displayName: row.normalized.input.displayName,
          eligibleEventSlugs: [...row.normalized.eventSlugs],
          greetingName: row.normalized.input.greetingName,
          invitees: row.normalized.input.invitees.map((invitee) => ({
            category: invitee.category,
            fullName: invitee.fullName,
            label: invitee.label,
          })),
          maxAdditionalChildren: row.normalized.input.maxAdditionalChildren,
          rsvpDeadlineAt:
            row.normalized.input.rsvpDeadlineAt?.toISOString() ?? null,
          rsvpDeadlineLocal: rsvpDeadline.local,
        };
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
    const existingKeys = new Set(
      existing.map((row) => duplicateKey(row.displayName)),
    );
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
