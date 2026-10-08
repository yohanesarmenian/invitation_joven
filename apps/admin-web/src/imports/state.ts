import type {
  GuestImportValidateResponse,
  GuestImportCommitRequest,
  GuestImportCommitResponse,
} from "@wedding-invitation/api-client/src/index";
import type { CommitResult } from "./client";
export type ImportStage =
  | "IDLE"
  | "FILE_SELECTED"
  | "VALIDATING"
  | "PREVIEW_READY"
  | "COMMITTING"
  | "COMMIT_UNCERTAIN"
  | "SUCCESS"
  | "FAILURE";
export type ImportState = {
  stage: ImportStage;
  file: File | null;
  preview: GuestImportValidateResponse | null;
  selected: number[];
  acknowledged: number[];
  saved: GuestImportCommitRequest | null;
  receipt: GuestImportCommitResponse | null;
  message: string;
};
export const initialImportState: ImportState = {
  stage: "IDLE",
  file: null,
  preview: null,
  selected: [],
  acknowledged: [],
  saved: null,
  receipt: null,
  message: "",
};
export const frozen = (s: ImportState) =>
  ["VALIDATING", "COMMITTING", "COMMIT_UNCERTAIN"].includes(s.stage);
export function commitPayload(
  s: ImportState,
  now = Date.now(),
): GuestImportCommitRequest | null {
  if (
    s.stage !== "PREVIEW_READY" ||
    !s.preview ||
    Date.parse(s.preview.expiresAt) <= now ||
    !s.selected.length
  )
    return null;
  const rows = s.selected.map((n) =>
    s.preview!.rows.find((r) => r.rowNumber === n),
  );
  if (
    rows.some(
      (r) =>
        !r ||
        r.status === "ERROR" ||
        (r.status === "VALID_WITH_WARNINGS" &&
          !s.acknowledged.includes(r.rowNumber)),
    )
  )
    return null;
  const body: GuestImportCommitRequest = {
    previewId: s.preview.previewId,
    includeRowNumbers: [...new Set(s.selected)].sort((a, b) => a - b),
    acknowledgedWarningRowNumbers: rows
      .filter((r) => r?.status === "VALID_WITH_WARNINGS")
      .map((r) => r!.rowNumber)
      .sort((a, b) => a - b),
  };
  Object.freeze(body.includeRowNumbers);
  Object.freeze(body.acknowledgedWarningRowNumbers);
  return Object.freeze(body);
}
export type ImportAction =
  | { type: "file"; file: File | null; problem?: string | null }
  | { type: "validate" }
  | { type: "preview"; preview: GuestImportValidateResponse }
  | { type: "failure"; message: string }
  | { type: "select" | "acknowledge"; rowNumber: number; checked: boolean }
  | { type: "commit"; body: GuestImportCommitRequest }
  | { type: "result"; result: CommitResult; recovery: boolean };
export function importReducer(s: ImportState, a: ImportAction): ImportState {
  switch (a.type) {
    case "file":
      return frozen(s)
        ? s
        : {
            ...initialImportState,
            file: a.file,
            stage: a.problem ? "FAILURE" : a.file ? "FILE_SELECTED" : "IDLE",
            message: a.problem ?? "",
          };
    case "validate":
      return frozen(s) || !s.file
        ? s
        : { ...initialImportState, file: s.file, stage: "VALIDATING" };
    case "preview":
      return {
        ...s,
        stage: "PREVIEW_READY",
        preview: a.preview,
        selected: a.preview.rows
          .filter((r) => r.status === "VALID")
          .map((r) => r.rowNumber),
        acknowledged: [],
        saved: null,
        message: "",
      };
    case "failure":
      return { ...s, stage: "FAILURE", message: a.message };
    case "select":
    case "acknowledge": {
      if (s.stage !== "PREVIEW_READY") return s;
      const row = s.preview?.rows.find((r) => r.rowNumber === a.rowNumber);
      if (!row || row.status === "ERROR") return s;
      const update = (values: number[]) =>
        a.checked
          ? [...new Set([...values, a.rowNumber])]
          : values.filter((n) => n !== a.rowNumber);
      if (a.type === "acknowledge")
        return row.status !== "VALID_WITH_WARNINGS"
          ? s
          : {
              ...s,
              acknowledged: update(s.acknowledged),
              selected: a.checked
                ? s.selected
                : s.selected.filter((n) => n !== a.rowNumber),
            };
      if (
        a.checked &&
        row.status === "VALID_WITH_WARNINGS" &&
        !s.acknowledged.includes(a.rowNumber)
      )
        return s;
      return { ...s, selected: update(s.selected) };
    }
    case "commit":
      return { ...s, stage: "COMMITTING", saved: a.body, message: "" };
    case "result": {
      const r = a.result;
      if (r.kind === "success")
        return {
          ...s,
          stage: "SUCCESS",
          receipt: r.receipt,
          saved: null,
          preview: null,
          selected: [],
          acknowledged: [],
        };
      if (
        r.kind === "uncertain" ||
        (a.recovery && !(r.kind === "rejected" && r.newPreview))
      )
        return {
          ...s,
          stage: "COMMIT_UNCERTAIN",
          message: r.kind === "rejected" || r.kind === "csrf" ? r.message : "",
        };
      if (r.kind === "rejected" && r.newPreview)
        return {
          ...s,
          stage: "FAILURE",
          preview: null,
          selected: [],
          acknowledged: [],
          saved: null,
          message: r.message,
        };
      return {
        ...s,
        stage: "PREVIEW_READY",
        saved: null,
        message:
          r.kind === "csrf" || r.kind === "rejected"
            ? r.message
            : "Your admin session has ended. Please sign in again.",
      };
    }
  }
}
