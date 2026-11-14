"use client";
import { useRef, useState, type FormEvent } from "react";
import type {
  AdminInvitationDetailResponse,
  UpdateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import {
  isoToJakartaInput,
  type FormErrors,
} from "../src/invitations/form-state";
import { updateInvitation } from "../src/invitations/lifecycle";
import {
  fromWibMinute,
  preserveUneditedMinute,
} from "../src/forms/wib-date-time";
import { ActionFeedback } from "./action-feedback";

type Invitation = AdminInvitationDetailResponse["invitation"];
type EditFields = {
  displayName: string;
  greetingName: string;
  allowPlusOne: boolean;
  children: string;
  deadline: string;
  notes: string;
};

function prepare(
  fields: EditFields,
  expectedUpdatedAt: string,
): { body: UpdateAdminInvitationRequest; errors: FormErrors } {
  const errors: FormErrors = {};
  const nullable = (v: string) => v.trim() || null;
  if (!fields.displayName.trim()) errors.displayName = "Enter a display name.";
  const maxAdditionalChildren = Number(fields.children);
  if (
    !/^\d+$/.test(fields.children) ||
    !Number.isSafeInteger(maxAdditionalChildren)
  )
    errors.children = "Enter a whole number of zero or more.";
  const rsvpDeadlineAt = fields.deadline
    ? fromWibMinute(fields.deadline)
    : null;
  if (fields.deadline && !rsvpDeadlineAt)
    errors.deadline = "Enter a valid date, hour and minute in Asia/Jakarta.";
  return {
    errors,
    body: {
      expectedUpdatedAt,
      displayName: fields.displayName.trim(),
      greetingName: nullable(fields.greetingName),
      allowPlusOne: fields.allowPlusOne,
      maxAdditionalChildren,
      rsvpDeadlineAt,
      notes: nullable(fields.notes),
    },
  };
}

export function EditInvitationForm({
  csrfToken,
  invitation,
}: {
  csrfToken: string;
  invitation: Invitation;
}) {
  const expectedUpdatedAt = useRef(invitation.updatedAt);
  const token = useRef(csrfToken);
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const [fields, setFields] = useState<EditFields>({
    displayName: invitation.displayName,
    greetingName: invitation.greetingName ?? "",
    allowPlusOne: invitation.allowPlusOne,
    children: String(invitation.maxAdditionalChildren),
    deadline: isoToJakartaInput(invitation.rsvpDeadlineAt),
    notes: invitation.notes ?? "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const deadlineEdited = useRef(false);

  function field<K extends keyof EditFields>(key: K, value: EditFields[K]) {
    if (key === "deadline") deadlineEdited.current = true;
    setFields((current) => ({ ...current, [key]: value }));
  }
  function feedback(text: string) {
    setMessage(text);
    requestAnimationFrame(() => notice.current?.focus());
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const prepared = prepare(fields, expectedUpdatedAt.current);
    prepared.body.rsvpDeadlineAt = preserveUneditedMinute(
      fields.deadline,
      invitation.rsvpDeadlineAt,
      deadlineEdited.current,
    );
    setErrors(prepared.errors);
    setConflict(false);
    if (Object.keys(prepared.errors).length) {
      feedback("Review the highlighted fields.");
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
          ?.focus(),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const result = await updateInvitation(
      invitation.id,
      prepared.body,
      token.current,
    );
    setPending(false);
    busy.current = false;
    if (result.kind === "updated") {
      window.location.replace(`/invitations/${invitation.id}?updated=1`);
      return;
    }
    if (result.kind === "session-ended") {
      window.location.replace(SESSION_ENDED_PATH);
      return;
    }
    if (result.kind === "csrf") {
      token.current = result.csrfToken;
      feedback(result.message);
      return;
    }
    if (result.kind === "conflict") {
      setConflict(true);
      feedback(
        "This invitation changed elsewhere. Your edits are still here. Reload latest state only when you are ready to replace this form.",
      );
      return;
    }
    feedback(
      result.kind === "validation"
        ? "The update was not accepted. Review the fields and submit again."
        : result.kind === "not-found"
          ? "Invitation was not found."
          : result.kind === "rejected"
            ? result.message
            : "The update result could not be confirmed. Reload the detail before trying again.",
    );
  }
  const errorProps = (id: string) => ({
    "aria-invalid": Boolean(errors[id]),
    "aria-describedby": errors[id] ? `${id}-error` : undefined,
  });
  const error = (id: string) =>
    errors[id] ? (
      <p className="field-error" id={`${id}-error`}>
        {errors[id]}
      </p>
    ) : null;
  return (
    <form
      aria-label="Edit invitation"
      className="invitation-create invitation-edit"
      noValidate
      onSubmit={submit}
      ref={form}
    >
      <div ref={notice} tabIndex={-1}>
        {message && <ActionFeedback tone="error">{message}</ActionFeedback>}
        {conflict && (
          <a
            className="dashboard-retry"
            href={`/invitations/${invitation.id}/edit`}
          >
            Reload latest state
          </a>
        )}
      </div>
      <fieldset disabled={pending}>
        <legend>Editable invitation fields</legend>
        <p className="hint">
          The concurrency version is the state loaded with this form.
        </p>
        <div className="create-grid">
          <div className="field">
            <label htmlFor="displayName">Display name (required)</label>
            <input
              id="displayName"
              required
              value={fields.displayName}
              onChange={(event) => field("displayName", event.target.value)}
              {...errorProps("displayName")}
            />
            {error("displayName")}
          </div>
          <div className="field">
            <label htmlFor="greetingName">Greeting name</label>
            <input
              id="greetingName"
              value={fields.greetingName}
              onChange={(event) => field("greetingName", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="children">
              Maximum additional children (required)
            </label>
            <input
              id="children"
              min={0}
              required
              step={1}
              type="number"
              value={fields.children}
              onChange={(event) => field("children", event.target.value)}
              {...errorProps("children")}
            />
            {error("children")}
          </div>
          <div className="field">
            <label htmlFor="deadline">RSVP deadline</label>
            <input
              aria-describedby={`deadline-help${errors.deadline ? " deadline-error" : ""}`}
              aria-invalid={Boolean(errors.deadline)}
              id="deadline"
              step="60"
              type="datetime-local"
              value={fields.deadline}
              onChange={(event) => field("deadline", event.target.value)}
            />
            <p className="hint" id="deadline-help">
              Asia/Jakarta (UTC+07:00). Leave blank for no deadline.
            </p>
            {error("deadline")}
          </div>
        </div>
        <label className="checkbox-label">
          <input
            checked={fields.allowPlusOne}
            onChange={(event) => field("allowPlusOne", event.target.checked)}
            type="checkbox"
          />
          Allow one plus-one guest
        </label>
        <div className="field">
          <label htmlFor="notes">Internal notes</label>
          <textarea
            aria-describedby="notes-help"
            id="notes"
            rows={4}
            value={fields.notes}
            onChange={(event) => field("notes", event.target.value)}
          />
          <p className="hint" id="notes-help">
            Visible only to the administrator.
          </p>
        </div>
      </fieldset>
      <p role="status" aria-live="polite">
        {pending ? "Saving invitation... Please wait." : ""}
      </p>
      <div className="form-actions">
        <button disabled={pending} type="submit">
          {pending ? "Saving..." : "Save changes"}
        </button>
        <a href={`/invitations/${invitation.id}`}>Cancel</a>
      </div>
    </form>
  );
}
