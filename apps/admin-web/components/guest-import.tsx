"use client";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { commitImport, validateImport } from "../src/imports/client";
import {
  commitPayload,
  frozen,
  importReducer,
  initialImportState,
} from "../src/imports/state";
import { fileProblem, importTemplate } from "../src/imports/template";
import { ImportPreview } from "./import-preview";

export function GuestImport({
  csrfToken,
  eventSlugs,
}: {
  csrfToken: string;
  eventSlugs: string[] | null;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(importReducer, initialImportState);
  const token = useRef(csrfToken);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const review = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [expired, setExpired] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!state.preview) return;
    const deadline = Date.parse(state.preview.expiresAt);
    const check = () => setExpired(Date.now() >= deadline);
    const timer = setInterval(check, 1000);
    const immediate = setTimeout(check, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(immediate);
    };
  }, [state.preview]);
  useEffect(() => {
    if (
      ["PREVIEW_READY", "FAILURE", "SUCCESS", "COMMIT_UNCERTAIN"].includes(
        state.stage,
      )
    )
      outcome.current?.focus();
  }, [state.stage]);
  const locked = frozen(state);
  const canCommit =
    state.stage === "PREVIEW_READY" && !expired && state.selected.length > 0;
  async function validate() {
    if (busy.current || locked || !state.file || fileProblem(state.file))
      return;
    busy.current = true;
    setExpired(false);
    dispatch({ type: "validate" });
    try {
      const result = await validateImport(state.file, token.current);
      if (result.kind === "session-ended") {
        router.replace(SESSION_ENDED_PATH);
        router.refresh();
        return;
      }
      if (result.kind === "csrf") token.current = result.csrfToken;
      if (result.kind === "preview")
        dispatch({ type: "preview", preview: result.preview });
      else dispatch({ type: "failure", message: result.message });
    } finally {
      busy.current = false;
    }
  }
  function closeConfirmation() {
    if (busy.current) return;
    dialog.current?.close();
    setConfirming(false);
    // The trigger is re-enabled by React after the dialog state update.
    requestAnimationFrame(() => {
      if (!busy.current) review.current?.focus();
    });
  }
  async function commit(recovery: boolean) {
    if (busy.current) return;
    const body =
      recovery && state.stage === "COMMIT_UNCERTAIN"
        ? state.saved
        : !recovery && confirming
          ? commitPayload(state)
          : null;
    if (!body) {
      closeConfirmation();
      return;
    }
    busy.current = true;
    dispatch({ type: "commit", body });
    try {
      const result = await commitImport(body, token.current);
      if (result.kind === "csrf") token.current = result.csrfToken;
      dialog.current?.close();
      setConfirming(false);
      dispatch({ type: "result", result, recovery });
      if (result.kind === "session-ended") {
        router.replace(SESSION_ENDED_PATH);
        router.refresh();
      }
    } finally {
      busy.current = false;
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([importTemplate(eventSlugs ?? [])], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "invitation-import-template.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="guest-import" data-state={state.stage}>
      <section className="import-panel" aria-labelledby="template-title">
        <h2 id="template-title">1. Prepare your file</h2>
        <button
          type="button"
          className="invitation-secondary"
          onClick={download}
        >
          Download CSV template
        </button>
        <p>
          One row = one household. Maximum 500 household rows and 5 MiB. Use
          UTF-8 CSV or an XLSX worksheet named Invitations.
        </p>
        <details>
          <summary>File format and column guidance</summary>
          <p>
            Keep the template headers unchanged. Set allowPlusOne to true or
            false, and maxAdditionalChildren to a non-negative whole number.
            Optional deadline: YYYY-MM-DD HH:mm, Asia/Jakarta (text, not an
            Excel date).
          </p>
          <p>
            The invitees cell contains a JSON array. Use category ADULT or CHILD
            and an optional label. Example format only:
          </p>
          <code className="import-example">
            {'[{"fullName":"Example Adult","category":"ADULT","label":null}]'}
          </code>
          <p>
            Optional event:&lt;slug&gt; columns use exact event slugs: true
            selects an event; false or blank does not. Only active events can be
            selected.
          </p>
          {eventSlugs === null ? (
            <p>
              Event discovery is unavailable. This template contains base
              columns only. Add event:&lt;slug&gt; columns only when you know
              the current exact event slugs.
            </p>
          ) : (
            <p>
              Template event columns:{" "}
              {eventSlugs.length
                ? eventSlugs.map((s) => `event:${s}`).join(", ")
                : "none; no active events available"}
              .
            </p>
          )}
          <p>
            The template contains headers only, with no sample households. Files
            are parsed and validated by the server.
          </p>
        </details>
      </section>
      <section className="import-panel" aria-labelledby="file-title">
        <h2 id="file-title">2. Select and validate</h2>
        <label htmlFor="import-file">
          {state.file ? "Replace CSV/XLSX file" : "CSV/XLSX file"}
        </label>
        <input
          ref={input}
          id="import-file"
          type="file"
          accept=".csv,.xlsx"
          disabled={locked || confirming}
          aria-describedby={
            state.message ? "file-help import-message" : "file-help"
          }
          onChange={(e) => {
            if (busy.current || locked) return;
            const file = e.target.files?.[0] ?? null;
            setExpired(false);
            dispatch({
              type: "file",
              file,
              problem: file ? fileProblem(file) : null,
            });
          }}
        />
        <p id="file-help" className="hint">
          CSV or XLSX, up to 5 MiB. Selecting a file does not upload it.
        </p>
        {state.file && (
          <p>
            Selected: <strong>{state.file.name}</strong> (
            {state.file.size.toLocaleString("en-US")} bytes)
          </p>
        )}
        <div className="invitation-actions">
          <button
            type="button"
            onClick={validate}
            disabled={
              !state.file ||
              locked ||
              confirming ||
              !!(state.file && fileProblem(state.file)) ||
              state.stage === "SUCCESS"
            }
          >
            {state.stage === "VALIDATING"
              ? "Validating…"
              : state.preview || state.stage === "FAILURE"
                ? "Validate file again"
                : "Validate file"}
          </button>
          {state.file && (
            <button
              type="button"
              className="invitation-secondary"
              disabled={locked || confirming}
              onClick={() => {
                if (busy.current) return;
                dispatch({ type: "file", file: null });
                setExpired(false);
                if (input.current) input.current.value = "";
                input.current?.focus();
              }}
            >
              Start new import
            </button>
          )}
        </div>
      </section>
      <div ref={outcome} tabIndex={-1} className="import-outcome">
        <p role="status">
          {state.stage === "VALIDATING"
            ? "Validating the file. No invitations are being created."
            : state.stage === "COMMITTING"
              ? "Confirming import. Please wait."
              : state.stage === "PREVIEW_READY"
                ? "Preview ready for review."
                : ""}
        </p>
        {state.message && (
          <p id="import-message" className="notice" role="alert">
            {state.message}
          </p>
        )}
        {expired && state.stage === "PREVIEW_READY" && (
          <p role="alert">This preview has expired. Validate the file again.</p>
        )}
        {state.stage === "COMMIT_UNCERTAIN" && (
          <section className="import-panel" aria-labelledby="uncertain-title">
            <h2 id="uncertain-title">Import outcome not confirmed</h2>
            <p role="alert">
              The import may have completed. Your original selection is saved on
              this page and cannot be changed. Check the result before starting
              another import.
            </p>
            <p>
              Checking resends the exact original request. If it already
              committed, the server returns its receipt. Otherwise, this action
              may perform the first import. Leaving or reloading this page loses
              the saved request.
            </p>
            <button type="button" onClick={() => commit(true)}>
              Check import result
            </button>
          </section>
        )}
        {state.stage === "SUCCESS" && state.receipt && (
          <section className="import-panel" aria-labelledby="success-title">
            <h2 id="success-title">Import complete</h2>
            <p role="status">The server confirmed this import.</p>
            <dl className="import-settings">
              <div>
                <dt>Batch ID</dt>
                <dd>{state.receipt.importBatch.id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{state.receipt.importBatch.status}</dd>
              </div>
              <div>
                <dt>Invitations created</dt>
                <dd>{state.receipt.importBatch.createdInvitationCount}</dd>
              </div>
              <div>
                <dt>Invitees created</dt>
                <dd>{state.receipt.importBatch.createdInviteeCount}</dd>
              </div>
              <div>
                <dt>Warnings</dt>
                <dd>{state.receipt.importBatch.warningCount}</dd>
              </div>
            </dl>
            <Link href="/invitations" prefetch={false}>
              View invitations
            </Link>
          </section>
        )}
      </div>
      <ImportPreview state={state} dispatch={dispatch} />
      {state.preview && (
        <div className="import-commit">
          <p>{state.selected.length} household(s) selected.</p>
          <button
            ref={review}
            type="button"
            disabled={!canCommit || confirming}
            onClick={() => {
              if (!commitPayload(state)) return;
              setConfirming(true);
              dialog.current?.showModal();
            }}
          >
            Review import
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="confirm-import-title"
        aria-describedby="confirm-import-description"
        onCancel={(e) => {
          e.preventDefault();
          closeConfirmation();
        }}
      >
        <h2 id="confirm-import-title">Confirm household import</h2>
        <p>
          {state.selected.length} household(s) selected.{" "}
          {state.selected.filter((n) => state.acknowledged.includes(n)).length}{" "}
          warning row(s) acknowledged.
        </p>
        <p id="confirm-import-description">
          This creates NEW Invitations. No existing household is merged or
          updated. All selected households are imported atomically: all succeed
          or none are created.
        </p>
        {state.stage === "COMMITTING" && (
          <p role="status">Confirming import. Please wait.</p>
        )}
        <div className="invitation-actions">
          <button
            type="button"
            className="invitation-secondary"
            disabled={state.stage === "COMMITTING"}
            onClick={closeConfirmation}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCommit}
            onClick={() => commit(false)}
          >
            Confirm import
          </button>
        </div>
      </dialog>
    </div>
  );
}
