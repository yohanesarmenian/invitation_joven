import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isPreview, isReceipt } from "../src/imports/contract";
import {
  BASE_HEADERS,
  csvCell,
  fileProblem,
  importTemplate,
} from "../src/imports/template";
import {
  commitPayload,
  importReducer,
  initialImportState,
  type ImportState,
} from "../src/imports/state";
import { commitImport, validateImport } from "../src/imports/client";
import { preview, receipt } from "./import-fixtures";
import { auth, failure, json } from "./fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ImportPreview } from "../components/import-preview";

const file = new File(["synthetic csv"], "households.csv", {
  type: "text/csv",
});
const ready = (): ImportState =>
  importReducer(
    { ...initialImportState, file, stage: "VALIDATING" },
    { type: "preview", preview },
  );
it("generates a header-only CSV with deterministic authoritative event columns and escaping", () => {
  expect(importTemplate([])).toBe(BASE_HEADERS.join(",") + "\r\n");
  expect(importTemplate(["reception", "ceremony", "reception"])).toBe(
    BASE_HEADERS.join(",") + ",event:ceremony,event:reception\r\n",
  );
  expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  expect(importTemplate(['a,"b'])).toContain('"event:a,""b"');
});
it.each([
  ["a.csv", 1, null],
  ["a.XLSX", 5242880, null],
  ["a.xls", 1, "Choose"],
  ["a.csv", 5242881, "exceeds"],
])("file policy %s %s", (name, size, expected) => {
  const result = fileProblem({ name: String(name), size: Number(size) });
  if (expected === null) expect(result).toBeNull();
  else expect(result).toContain(expected);
});
it("accepts repaired fields and legitimate error rows without parsed data", () => {
  expect(isPreview(preview)).toBe(true);
  expect(isReceipt(receipt)).toBe(true);
});
it.each([
  "displayName",
  "greetingName",
  "allowPlusOne",
  "maxAdditionalChildren",
  "rsvpDeadlineLocal",
  "rsvpDeadlineAt",
  "invitees",
  "eligibleEventSlugs",
])("rejects malformed parsed %s", (key) => {
  const value = structuredClone(preview);
  Reflect.set(value.rows[0]!.parsed!, key, {});
  expect(isPreview(value)).toBe(false);
});
it.each([
  {},
  null,
  { ...preview, previewId: "bad" },
  { ...preview, expiresAt: "bad" },
  { ...preview, rows: [...preview.rows, preview.rows[0]] },
  { ...preview, summary: { ...preview.summary, validRows: 1 } },
])("rejects malformed preview %#", (value) =>
  expect(isPreview(value)).toBe(false),
);
it.each([
  {},
  null,
  { importBatch: { ...receipt.importBatch, status: "FAILED" } },
  { importBatch: { ...receipt.importBatch, createdInvitationCount: -1 } },
])("rejects malformed receipt %#", (value) =>
  expect(isReceipt(value)).toBe(false),
);
it("requires per-row acknowledgment before selection, and deselects revoked acknowledgment", () => {
  let state = ready();
  expect(state.selected).toEqual([2]);
  state = importReducer(state, { type: "select", rowNumber: 5, checked: true });
  expect(state.selected).toEqual([2]);
  state = importReducer(state, { type: "select", rowNumber: 8, checked: true });
  expect(state.selected).toEqual([2]);
  state = importReducer(state, {
    type: "acknowledge",
    rowNumber: 5,
    checked: true,
  });
  state = importReducer(state, { type: "select", rowNumber: 5, checked: true });
  const body = commitPayload(state)!;
  expect(body).toEqual({
    previewId: preview.previewId,
    includeRowNumbers: [2, 5],
    acknowledgedWarningRowNumbers: [5],
  });
  expect(Object.isFrozen(body.includeRowNumbers)).toBe(true);
  state = importReducer(state, {
    type: "acknowledge",
    rowNumber: 5,
    checked: false,
  });
  expect(state.selected).toEqual([2]);
  expect(commitPayload(state)!.acknowledgedWarningRowNumbers).toEqual([]);
  expect(commitPayload(state, Date.parse(preview.expiresAt))).toBeNull();
});
it("explicit state transitions clear old data on replacement and freeze uncertainty", () => {
  let s = importReducer(initialImportState, { type: "file", file });
  expect(s.stage).toBe("FILE_SELECTED");
  s = importReducer(s, { type: "validate" });
  expect(s.stage).toBe("VALIDATING");
  s = importReducer(s, { type: "preview", preview });
  const body = commitPayload(s)!;
  s = importReducer(s, { type: "commit", body });
  expect(importReducer(s, { type: "file", file: null })).toBe(s);
  s = importReducer(s, {
    type: "result",
    result: { kind: "uncertain" },
    recovery: false,
  });
  expect(s.stage).toBe("COMMIT_UNCERTAIN");
  expect(s.saved).toBe(body);
  expect(
    importReducer(s, { type: "select", rowNumber: 2, checked: false }),
  ).toBe(s);
  expect(importReducer(s, { type: "file", file: null })).toBe(s);
  for (const result of [
    { kind: "csrf", csrfToken: "new", message: "refreshed" },
    { kind: "rejected", message: "forbidden" },
  ] as const) {
    s = importReducer(s, { type: "result", result, recovery: true });
    expect(s.stage).toBe("COMMIT_UNCERTAIN");
    expect(s.saved).toBe(body);
  }
  s = importReducer(s, {
    type: "result",
    result: { kind: "success", receipt },
    recovery: true,
  });
  expect(s.stage).toBe("SUCCESS");
  expect(s.receipt).toBe(receipt);
  s = importReducer(s, { type: "file", file });
  expect(s.preview).toBeNull();
  expect(s.receipt).toBeNull();
  expect(s.selected).toEqual([]);
});
it("domain conflicts discard obsolete preview while definite validation rejection preserves selection", () => {
  const s = ready();
  expect(
    importReducer(s, {
      type: "result",
      result: { kind: "rejected", message: "invalid" },
      recovery: false,
    }).selected,
  ).toEqual([2]);
  expect(
    importReducer(s, {
      type: "result",
      result: { kind: "rejected", message: "stale", newPreview: true },
      recovery: true,
    }).preview,
  ).toBeNull();
});
it("renders normalized fields, local deadline, ordered invitees and structured issues", () => {
  const html = renderToStaticMarkup(
    createElement(ImportPreview, { state: ready(), dispatch: () => undefined }),
  );
  for (const part of [
    "Asia/Jakarta",
    "2027-01-16 18:30",
    "RSVP deadline (UTC)",
    "2027-01-16T11:30:00.000Z",
    "Example Adult",
    "Example Child",
    "ADULT",
    "CHILD",
    "Parent",
    "ceremony, reception",
    "VALID_WITH_WARNINGS",
    "INVALID_JSON",
    "Column: invitees",
    "NEW Invitation",
  ])
    expect(html).toContain(part);
  expect(html.indexOf("Example Adult")).toBeLessThan(
    html.indexOf("Example Child"),
  );
});
const NativeRequest = Request,
  fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === "string"
            ? new URL(input, "http://localhost:3001")
            : input,
          init,
        );
      }
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("sends real multipart, one file, generated boundary, CSRF and same-origin credentials", async () => {
  fetchMock.mockResolvedValue(json(preview, 201));
  expect((await validateImport(file, "csrf")).kind).toBe("preview");
  const request: Request = fetchMock.mock.calls[0]![0];
  expect(request.url).toBe(
    "http://localhost:3001/api/admin/imports/guest/validate",
  );
  expect(request.method).toBe("POST");
  expect(request.credentials).toBe("same-origin");
  expect(request.cache).toBe("no-store");
  expect(request.redirect).toBe("error");
  expect(request.headers.get("content-type")).toMatch(
    /^multipart\/form-data; boundary=/,
  );
  expect(request.headers.get("x-csrf-token")).toBe("csrf");
  const data = await request.formData();
  expect([...data.keys()]).toEqual(["file"]);
  const uploaded = data.get("file");
  expect(uploaded).toBeInstanceOf(File);
  if (uploaded instanceof File)
    expect(await uploaded.text()).toBe("synthetic csv");
});
it("sends only generated canonical commit body", async () => {
  fetchMock.mockResolvedValue(json(receipt));
  const body = commitPayload(ready())!;
  expect((await commitImport(body, "csrf")).kind).toBe("success");
  const request: Request = fetchMock.mock.calls[0]![0];
  expect(await request.json()).toEqual(body);
  expect(request.headers.get("x-csrf-token")).toBe("csrf");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([
  [400, "VALIDATION_ERROR", "rejected"],
  [401, "UNAUTHENTICATED", "session-ended"],
  [403, "FORBIDDEN", "rejected"],
  [409, "IMPORT_PREVIEW_STALE", "rejected"],
  [409, "IMPORT_PREVIEW_EXPIRED", "rejected"],
  [409, "IMPORT_PREVIEW_ALREADY_COMMITTED", "rejected"],
  [500, "INTERNAL_ERROR", "uncertain"],
  [400, "UNKNOWN", "uncertain"],
])("maps commit %s %s without retry", async (status, code, kind) => {
  fetchMock.mockResolvedValue(failure(String(code), Number(status)));
  const result = await commitImport(commitPayload(ready())!, "csrf");
  expect(result.kind).toBe(kind);
  expect(JSON.stringify(result)).not.toContain("Private");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("malformed success and network failures cannot claim committed success", async () => {
  fetchMock
    .mockResolvedValueOnce(json({}))
    .mockRejectedValueOnce(new Error("private"));
  for (let n = 0; n < 2; n++)
    expect((await commitImport(commitPayload(ready())!, "csrf")).kind).toBe(
      "uncertain",
    );
});
it.each(["validate", "commit"])(
  "%s CSRF refresh never replays a mutation",
  async (mode) => {
    fetchMock
      .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
      .mockResolvedValueOnce(json(auth));
    const result =
      mode === "validate"
        ? await validateImport(file, "old")
        : await commitImport(commitPayload(ready())!, "old");
    expect(result.kind).toBe("csrf");
    expect(fetchMock.mock.calls.map((c) => c[0].method)).toEqual([
      "POST",
      "GET",
    ]);
  },
);
it("validate network failures are safe explicit revalidation failures", async () => {
  fetchMock.mockRejectedValue(new Error("private"));
  const result = await validateImport(file, "csrf");
  expect(result.kind).toBe("rejected");
  expect(JSON.stringify(result)).not.toContain("private");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
