import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { isSupportedInvitationSessionCount } from "../invitations/eligibility-policy.js";
import type {
  GuestImportIssueDto,
  GuestImportParsedInviteeDto,
} from "./dto/guest-import.dto.js";

export const MAX_IMPORT_ROWS = 500;
const MAX_WEDDING_SESSIONS = 100;
const MAX_GUESTS_PER_HOUSEHOLD = 20;
const MAX_GUEST_ROWS = MAX_IMPORT_ROWS * MAX_GUESTS_PER_HOUSEHOLD;
export const GUEST_WORKBOOK_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const GUEST_WORKBOOK_PATH = "guest-import-template.xlsx";

const TEMPLATE_KIND = "HEYJO_GUEST_IMPORT";
const TEMPLATE_VERSION = 2;
const BOTH = "AB • Both sessions";
const INVITATION_HEADERS = [
  "HouseholdRef",
  "DisplayName",
  "GreetingName",
  "PlusOneAllowed",
  "AdditionalChildren",
  "RSVPDeadlineWIB",
  "Notes",
];
const GUEST_HEADERS = ["HouseholdRef", "FullName", "Category", "Label"];
const EVENT_HEADERS = [
  "OptionKey",
  "EventSlug",
  "Name",
  "StartsAtWIB",
  "Venue",
];
const EVENT_METADATA_HEADERS = [
  ...EVENT_HEADERS,
  "Session choices",
  "Session binding",
];
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "short",
});

export type WorkbookEvent = {
  id: string;
  slug: string;
  name: string;
  startsAt: Date | null;
  venueName: string | null;
};

type WorkbookRow = {
  cells: unknown[];
  rowNumber: number;
  errors?: GuestImportIssueDto[];
  invitees?: GuestImportParsedInviteeDto[];
};

export function workbookError(message: string): never {
  throw new BadRequestException({
    code: "IMPORT_WORKBOOK_INVALID",
    details: null,
    message,
  });
}

export function eventReviewSnapshot(event: WorkbookEvent): string {
  return JSON.stringify([
    event.id,
    event.slug,
    event.name,
    event.startsAt?.toISOString() ?? null,
    event.venueName,
  ]);
}

function eventBinding(event: WorkbookEvent): string {
  return createHash("sha256").update(eventReviewSnapshot(event)).digest("hex");
}

function eventOptions(events: readonly WorkbookEvent[]) {
  return events.map((event, index) => {
    const key =
      index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    return {
      event,
      key,
      label: key + " • " + event.name.trim(),
      startsAt: event.startsAt
        ? dateFormatter.format(event.startsAt) + " WIB"
        : "",
    };
  });
}

function selectionHeaders(options: ReturnType<typeof eventOptions>) {
  return options.length > 2
    ? options.map(({ key, event }) => "[" + key + "] " + event.name)
    : ["SessionSelection"];
}

function worksheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  widths: number[],
) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = headers.map((header, index) => ({
    header,
    width: widths[index] ?? 32,
    style: { numFmt: "@" },
  }));
  const header = sheet.getRow(1);
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF18283C" },
  };
  header.font = { bold: true, color: { argb: "FFF9F1DF" } };
  header.alignment = { wrapText: true, vertical: "middle" };
  header.height = 30;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  return sheet;
}

function dropdown(
  sheet: ExcelJS.Worksheet,
  column: string,
  lastRow: number,
  source: string,
) {
  // ExcelJS exposes range validation in the runtime but omits it from Worksheet typings.
  const validation = sheet as ExcelJS.Worksheet & {
    dataValidations: { add(range: string, rule: ExcelJS.DataValidation): void };
  };
  validation.dataValidations.add(column + "2:" + column + lastRow, {
    type: "list",
    allowBlank: true,
    formulae: [source],
    showErrorMessage: true,
    errorStyle: "error",
    errorTitle: "Choose a listed option",
    error: "Select a value from the dropdown.",
  });
}

export async function createGuestWorkbook(
  events: readonly WorkbookEvent[],
): Promise<Buffer> {
  if (events.length < 1 || events.length > MAX_WEDDING_SESSIONS) {
    workbookError(
      "Open Events and configure an eligible session before downloading the Excel template.",
    );
  }
  const workbook = new ExcelJS.Workbook();
  const options = eventOptions(events);
  const instructions = workbook.addWorksheet("Instructions");
  instructions.columns = [{ width: 24 }, { width: 96 }];
  instructions.addRows([
    ["TemplateKind", TEMPLATE_KIND],
    ["TemplateVersion", TEMPLATE_VERSION],
    ["EventSelection", options.length > 2 ? "columns" : "dropdown"],
    [
      "Prepare the guest list",
      "Add one Invitations row for each person, couple, or household. Give each row a unique HouseholdRef such as F001.",
    ],
    [
      "Add named guests",
      "Add one Guests row per person. Repeat the same HouseholdRef for everyone sharing an invitation, in the order you want their names shown.",
    ],
    [
      "Guest categories",
      "Select Adult or Child. Label and GreetingName are optional. HouseholdRef is case-insensitive and can contain up to 32 letters, digits, underscores or hyphens.",
    ],
    [
      "Wedding sessions",
      options.length > 2
        ? "Choose Yes in one or two session columns. Leave other sessions blank or select No."
        : "Select a named session or both where available. Keep the prefilled session when there is only one.",
    ],
    [
      "Optional RSVP deadline",
      "Enter the deadline as text in WIB (Asia/Jakarta), for example 2027-01-01 17:00. Leave it blank to use the applicable event policy.",
    ],
    [
      "Extra guests",
      "Set PlusOneAllowed to Yes or No and AdditionalChildren to a non-negative whole number. Blank means No or zero.",
    ],
    [
      "Limits",
      "Up to 500 invitations, 20 named guests per invitation, and 5 MiB. Keep the headers and Events worksheet unchanged. Paste values only.",
    ],
    [
      "Preview and confirm",
      "Save as .xlsx. Upload in Admin, correct any errors, acknowledge possible duplicates, and review the selected invitations before confirming.",
    ],
    [
      "Privacy",
      "Keep filled workbooks private. The template contains no sample guest data to remove.",
    ],
  ]);
  instructions.eachRow((row) => {
    row.getCell(1).font = { bold: true };
    row.alignment = { wrapText: true, vertical: "middle" };
    row.height = row.number > 3 ? 34 : 21;
  });
  const invitations = worksheet(
    workbook,
    "Invitations",
    [...INVITATION_HEADERS, ...selectionHeaders(options)],
    [19, 34, 30, 21, 21, 24, 36, 48],
  );
  const guests = worksheet(workbook, "Guests", GUEST_HEADERS, [19, 36, 18, 30]);
  const eventSheet = worksheet(
    workbook,
    "Events",
    EVENT_METADATA_HEADERS,
    [15, 26, 34, 31, 35, 48],
  );
  eventSheet.getColumn("G").hidden = true;
  for (const { key, event, startsAt, label } of options) {
    eventSheet.addRow([
      key,
      event.slug,
      event.name,
      startsAt,
      event.venueName ?? "",
      options.length <= 2 ? label : "",
      eventBinding(event),
    ]);
  }

  if (options.length > 2) {
    for (const index of options.keys()) {
      dropdown(
        invitations,
        invitations.getColumn(8 + index).letter,
        MAX_IMPORT_ROWS + 1,
        '"Yes,No"',
      );
    }
  } else {
    if (options.length === 2) eventSheet.getCell("F4").value = BOTH;
    const lastChoice = options.length === 1 ? 2 : 4;
    workbook.definedNames.add(
      "Events!$F$2:$F$" + lastChoice,
      "WeddingSessionChoices",
    );
    dropdown(invitations, "H", MAX_IMPORT_ROWS + 1, "WeddingSessionChoices");
    if (options.length === 1) {
      for (let row = 2; row <= MAX_IMPORT_ROWS + 1; row++) {
        invitations.getCell("H" + row).value = options[0]!.label;
      }
    }
  }
  dropdown(invitations, "D", MAX_IMPORT_ROWS + 1, '"Yes,No"');
  dropdown(guests, "C", MAX_GUEST_ROWS + 1, '"Adult,Child"');
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function isGuestWorkbookV2(workbook: ExcelJS.Workbook): boolean {
  const instruction = workbook.getWorksheet("Instructions");
  return (
    instruction?.getCell("A1").value === "TemplateKind" ||
    instruction?.getCell("A2").value === "TemplateVersion" ||
    workbook.getWorksheet("Invitations")?.getCell("A1").value === "HouseholdRef"
  );
}

function readRows(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: readonly string[],
  limit: number,
  readText: (value: string, location: string) => string,
  placeholderSession?: string,
): WorkbookRow[] {
  const sheet = workbook.getWorksheet(name);
  if (
    !sheet ||
    sheet.state !== "visible" ||
    Object.keys(
      (sheet as ExcelJS.Worksheet & { _merges?: object })._merges ?? {},
    ).length > 0
  ) {
    workbookError(name + " must be a visible worksheet without merged cells.");
  }
  const width = headers.length;
  const header = sheet.getRow(1);
  if (
    header.cellCount > width ||
    !headers.every((value, index) => header.getCell(index + 1).value === value)
  ) {
    workbookError(
      name + " row 1 has unexpected headers. Use a fresh Excel template.",
    );
  }
  const result: WorkbookRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rowNumber > limit * 4 + 1 || row.cellCount > width) {
      workbookError(
        name +
          " exceeds its row or column limit. Remove extra data or use a fresh template.",
      );
    }
    const cells = Array.from({ length: width }, (_, index) => {
      const cell = row.getCell(index + 1);
      const value = cell.value;
      if (
        value !== null &&
        typeof value === "object" &&
        !(value instanceof Date)
      ) {
        workbookError(
          name +
            " cell " +
            cell.address +
            " must contain a plain value. Paste values only.",
        );
      }
      return typeof value === "string"
        ? readText(value, name + " cell " + cell.address)
        : value;
    });
    if (
      placeholderSession &&
      cells[7] === placeholderSession &&
      cells.slice(0, 7).every((value) => value === null || value === "")
    )
      return;
    if (!cells.some((value) => value !== null && value !== "")) return;
    if (result.length >= limit) {
      workbookError(name + " contains too many data rows.");
    }
    result.push({ cells, rowNumber });
  });
  return result;
}

function normalizedRef(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value)
    ? value.toUpperCase()
    : null;
}

function yesNo(value: unknown): unknown {
  if (value === null || value === "" || value === "No") return false;
  return value === "Yes" ? true : value;
}

function rowError(
  rowNumber: number,
  column: string,
  message: string,
  field: string | null = null,
): GuestImportIssueDto {
  return { rowNumber, column, field, code: "INVALID_VALUE", message };
}

export function readGuestWorkbook(
  workbook: ExcelJS.Workbook,
  events: readonly WorkbookEvent[],
  baseHeaders: readonly string[],
): WorkbookRow[] {
  const instructions = workbook.getWorksheet("Instructions");
  const mode = events.length > 2 ? "columns" : "dropdown";
  if (
    instructions?.state !== "visible" ||
    instructions.getCell("A1").value !== "TemplateKind" ||
    instructions.getCell("B1").value !== TEMPLATE_KIND ||
    instructions.getCell("A2").value !== "TemplateVersion" ||
    instructions.getCell("B2").value !== TEMPLATE_VERSION ||
    instructions.getCell("A3").value !== "EventSelection" ||
    !["columns", "dropdown"].includes(
      instructions.getCell("B3").value as string,
    ) ||
    workbook.worksheets.length > 5
  ) {
    workbookError(
      "Excel template version or layout is invalid. Download a fresh template.",
    );
  }
  if (
    !events.length ||
    events.length > MAX_WEDDING_SESSIONS ||
    instructions.getCell("B3").value !== mode
  ) {
    workbookError(
      "The active wedding sessions have changed. Download a fresh Excel template.",
    );
  }
  const options = eventOptions(events);
  let decodedText = 0;
  function readText(value: string, location: string): string {
    decodedText += value.length;
    if (decodedText > 2_000_000 || value.length > 2_000) {
      workbookError(
        location +
          " exceeds the workbook text limit. Shorten long entries or split the file.",
      );
    }
    return value.trim();
  }
  const eventRows = readRows(
    workbook,
    "Events",
    EVENT_METADATA_HEADERS,
    MAX_WEDDING_SESSIONS + 1,
    readText,
  );
  const bothOption = options.length === 2 ? eventRows[2] : undefined;
  if (
    (options.length === 2 &&
      (bothOption?.rowNumber !== 4 ||
        bothOption.cells[5] !== BOTH ||
        Boolean(bothOption.cells[6]) ||
        bothOption.cells
          .slice(0, 5)
          .some((value) => value !== null && value !== ""))) ||
    eventRows.length !== options.length + Number(options.length === 2) ||
    options.some(({ key, event, startsAt, label }, index) => {
      const expected = [
        key,
        event.slug,
        event.name.trim(),
        startsAt,
        event.venueName?.trim() ?? "",
        options.length <= 2 ? label : "",
        eventBinding(event),
      ];
      return !expected.every(
        (value, col) => value === (eventRows[index]?.cells[col] ?? ""),
      );
    })
  ) {
    workbookError(
      "The Events worksheet differs from the active wedding sessions. Download a fresh Excel template.",
    );
  }

  const headers = [...INVITATION_HEADERS, ...selectionHeaders(options)];
  const invitations = readRows(
    workbook,
    "Invitations",
    headers,
    MAX_IMPORT_ROWS,
    readText,
    options.length === 1 ? options[0]!.label : undefined,
  );
  const guests = readRows(
    workbook,
    "Guests",
    GUEST_HEADERS,
    MAX_GUEST_ROWS,
    readText,
  );

  const households = new Map<string, WorkbookRow[]>();
  for (const row of invitations) {
    const ref = normalizedRef(row.cells[0]);
    row.errors = [];
    row.invitees = [];
    if (!ref) {
      row.errors.push(
        rowError(
          row.rowNumber,
          "HouseholdRef",
          "Use 1–32 letters, digits, underscores or hyphens, starting with a letter or digit.",
        ),
      );
      continue;
    }
    const matches = households.get(ref) ?? [];
    matches.push(row);
    households.set(ref, matches);
  }
  for (const matches of households.values()) {
    if (matches.length < 2) continue;
    for (const row of matches) {
      row.errors!.push(
        rowError(
          row.rowNumber,
          "HouseholdRef",
          "Duplicate reference in Invitations. Give each invitation a unique reference.",
        ),
      );
    }
  }
  for (const { cells, rowNumber } of guests) {
    const ref = normalizedRef(cells[0]);
    const matches = ref ? households.get(ref) : undefined;
    if (!matches) {
      workbookError(
        "Guests row " +
          rowNumber +
          ", HouseholdRef: use a reference from Invitations before previewing the workbook.",
      );
    }
    if (matches.length !== 1) continue;
    const household = matches[0]!;
    const [, fullName, category, label] = cells;
    const column =
      typeof fullName !== "string" || !fullName
        ? "FullName"
        : category !== "Adult" && category !== "Child"
          ? "Category"
          : label !== null && typeof label !== "string"
            ? "Label"
            : null;
    if (column) {
      household.errors!.push(
        rowError(
          household.rowNumber,
          column,
          "Guests row " +
            rowNumber +
            ": enter a name, select Adult or Child, and use text for the optional label.",
          "invitees",
        ),
      );
    } else if (household.invitees!.length === MAX_GUESTS_PER_HOUSEHOLD) {
      if (!household.errors!.some((error) => error.column === "Guests")) {
        household.errors!.push(
          rowError(
            household.rowNumber,
            "Guests",
            "Guests row " +
              rowNumber +
              ": this reference exceeds 20 named guests.",
            "invitees",
          ),
        );
      }
    } else {
      household.invitees!.push({
        fullName: fullName as string,
        category: category === "Adult" ? "ADULT" : "CHILD",
        label: (label as string | null) || null,
      });
    }
  }

  return [
    {
      rowNumber: 1,
      cells: [...baseHeaders, ...events.map(({ slug }) => "event:" + slug)],
    },
    ...invitations.map(({ cells, rowNumber, errors = [], invitees = [] }) => {
      if (
        !invitees.length &&
        !errors.some((error) => error.field === "invitees")
      ) {
        errors.push(
          rowError(
            rowNumber,
            "HouseholdRef",
            "Add at least one matching named guest on the Guests worksheet.",
            "invitees",
          ),
        );
      }
      const picked = cells[7];
      const selected =
        mode === "columns"
          ? cells.slice(7).map(yesNo)
          : options.map(
              ({ label }) =>
                picked === label || (options.length === 2 && picked === BOTH),
            );
      if (
        selected.some((value) => typeof value !== "boolean") ||
        !isSupportedInvitationSessionCount(
          selected.filter((value) => value === true).length,
        )
      ) {
        errors.push(
          rowError(
            rowNumber,
            mode === "columns" ? "Wedding sessions" : "SessionSelection",
            "Select one or two sessions from the workbook’s current choices.",
            "eventIds",
          ),
        );
      }
      const deadline = cells[5];
      const children = cells[4] === "" || cells[4] === null ? 0 : cells[4];
      if (
        (typeof children === "number" || typeof children === "string") &&
        Number(children) > 2_147_483_647
      ) {
        errors.push(
          rowError(
            rowNumber,
            "AdditionalChildren",
            "Enter a whole number no greater than 2147483647.",
            "maxAdditionalChildren",
          ),
        );
      }
      return {
        rowNumber,
        errors,
        invitees,
        cells: [
          cells[1] ?? "",
          cells[2] ?? "",
          yesNo(cells[3]),
          children,
          typeof deadline === "number" || deadline instanceof Date
            ? false
            : deadline,
          cells[6] ?? "",
          null,
          ...selected.map((value) => value === true),
        ],
      };
    }),
  ];
}
