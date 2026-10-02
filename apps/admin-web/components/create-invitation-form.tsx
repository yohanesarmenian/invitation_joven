"use client";
import { useRef, useState, type FormEvent } from "react";
import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
import {
  createInvitation,
  UNCERTAIN_CREATE,
} from "../src/invitations/create-invitation";
import {
  prepareInvitation,
  type CreateFields,
  type FormErrors,
} from "../src/invitations/form-state";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";

export function CreateInvitationForm({
  events,
  csrfToken,
}: {
  events: AdminEventsResponse["events"];
  csrfToken: string;
}) {
  const [fields, setFields] = useState<CreateFields>({
    displayName: "",
    greetingName: "",
    allowPlusOne: false,
    children: "0",
    deadline: "",
    notes: "",
    eventIds: [],
    invitees: [{ fullName: "", category: "ADULT", label: "" }],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState<"list" | "reload" | null>(null);
  const busy = useRef(false);
  const token = useRef(csrfToken);
  const formRef = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const [keys, setKeys] = useState([0]);
  const nextKey = useRef(1);
  function field<K extends keyof CreateFields>(key: K, value: CreateFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  function feedback(text: string) {
    setMessage(text);
    requestAnimationFrame(() => notice.current?.focus());
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || locked) return;
    const prepared = prepareInvitation(fields, events);
    setErrors(prepared.errors);
    if (Object.keys(prepared.errors).length) {
      setMessage("Review the highlighted fields.");
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
          ?.focus(),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage("");
    const result = await createInvitation(prepared.body, token.current);
    if (result.kind === "created" || result.kind === "session-ended") {
      // Full navigation refreshes server reads and prevents reusing stale list data.
      window.location.replace(
        result.kind === "created"
          ? "/invitations?created=1"
          : SESSION_ENDED_PATH,
      );
      return;
    }
    setPending(false);
    if (result.kind === "uncertain") {
      setLocked(true);
      setRecovery("list");
      feedback(UNCERTAIN_CREATE);
      return;
    }
    if (result.kind === "reload") {
      setLocked(true);
      setRecovery("reload");
      feedback(result.message);
      return;
    }
    busy.current = false;
    if (result.kind === "csrf") {
      token.current = result.csrfToken;
      feedback(
        "Your session was refreshed. The invitation was not submitted. Review the form and select Create invitation again.",
      );
    } else if (result.kind === "rejected") feedback(result.message);
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
      className="invitation-create"
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label="Create invitation"
    >
      <div ref={notice} tabIndex={-1} role={message ? "alert" : undefined}>
        {message && <p className="notice">{message}</p>}
        {recovery && (
          <a
            className="dashboard-retry"
            href={recovery === "list" ? "/invitations" : "/invitations/new"}
          >
            {recovery === "list"
              ? "Check invitations list"
              : "Reload event options and session"}
          </a>
        )}
      </div>
      <fieldset disabled={pending || locked}>
        <legend>Invitation details</legend>
        <p className="hint">Fields marked required must be completed.</p>
        <div className="create-grid">
          <div className="field">
            <label htmlFor="displayName">Display name (required)</label>
            <input
              id="displayName"
              required
              value={fields.displayName}
              onChange={(e) => field("displayName", e.target.value)}
              {...errorProps("displayName")}
            />
            {error("displayName")}
          </div>
          <div className="field">
            <label htmlFor="greetingName">Greeting name</label>
            <input
              id="greetingName"
              value={fields.greetingName ?? ""}
              onChange={(e) => field("greetingName", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="children">
              Maximum additional children (required)
            </label>
            <input
              id="children"
              type="number"
              min={0}
              step={1}
              required
              value={fields.children}
              onChange={(e) => field("children", e.target.value)}
              {...errorProps("children")}
            />
            {error("children")}
          </div>
          <div className="field">
            <label htmlFor="deadline">RSVP deadline</label>
            <input
              id="deadline"
              type="datetime-local"
              step="0.001"
              value={fields.deadline}
              onChange={(e) => field("deadline", e.target.value)}
              {...errorProps("deadline")}
              aria-describedby={`deadline-help${errors.deadline ? " deadline-error" : ""}`}
            />
            <p className="hint" id="deadline-help">
              Asia/Jakarta (UTC+07:00). Leave blank for no deadline.
            </p>
            {error("deadline")}
          </div>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={fields.allowPlusOne}
            onChange={(e) => field("allowPlusOne", e.target.checked)}
          />
          Allow one plus-one guest
        </label>
        <div className="field">
          <label htmlFor="notes">Internal notes</label>
          <textarea
            id="notes"
            rows={3}
            value={fields.notes ?? ""}
            onChange={(e) => field("notes", e.target.value)}
            aria-describedby="notes-help"
          />
          <p className="hint" id="notes-help">
            Visible only to the administrator.
          </p>
        </div>
      </fieldset>
      <fieldset
        disabled={pending || locked}
        aria-describedby={errors.eventIds ? "eventIds-error" : undefined}
      >
        <legend>Eligible events (at least one required)</legend>
        <p className="hint">
          Only active events can be added to a new invitation.
        </p>
        {events.map((event) => (
          <label key={event.id} className="checkbox-label">
            <input
              type="checkbox"
              disabled={!event.isActive}
              checked={fields.eventIds.includes(event.id)}
              onChange={(e) =>
                field(
                  "eventIds",
                  e.target.checked
                    ? [...fields.eventIds, event.id]
                    : fields.eventIds.filter((id) => id !== event.id),
                )
              }
              {...errorProps("eventIds")}
            />
            {event.name}
            {!event.isActive && " (inactive)"}
          </label>
        ))}
        {error("eventIds")}
      </fieldset>
      <fieldset disabled={pending || locked}>
        <legend>Initial invitees (at least one required)</legend>
        <p className="hint">
          Add named guests in the order they should appear. Guests may share a
          name.
        </p>
        {error("invitees")}
        {fields.invitees.map((row, index) => (
          <fieldset key={keys[index]} className="invitee-row">
            <legend>Invitee {index + 1}</legend>
            <div className="create-grid">
              <div className="field">
                <label htmlFor={`invitee-${index}`}>Full name (required)</label>
                <input
                  id={`invitee-${index}`}
                  required
                  value={row.fullName}
                  onChange={(e) =>
                    field(
                      "invitees",
                      fields.invitees.map((item, i) =>
                        i === index
                          ? { ...item, fullName: e.target.value }
                          : item,
                      ),
                    )
                  }
                  {...errorProps(`invitee-${index}`)}
                />
                {error(`invitee-${index}`)}
              </div>
              <div className="field">
                <label htmlFor={`category-${index}`}>Category (required)</label>
                <select
                  id={`category-${index}`}
                  value={row.category}
                  required
                  onChange={(e) => {
                    const category = e.target.value;
                    if (category === "ADULT" || category === "CHILD")
                      field(
                        "invitees",
                        fields.invitees.map((item, i) =>
                          i === index ? { ...item, category } : item,
                        ),
                      );
                  }}
                  {...errorProps(`category-${index}`)}
                >
                  <option value="ADULT">Adult</option>
                  <option value="CHILD">Child</option>
                </select>
                {error(`category-${index}`)}
              </div>
              <div className="field">
                <label htmlFor={`label-${index}`}>Label</label>
                <input
                  id={`label-${index}`}
                  value={row.label ?? ""}
                  onChange={(e) =>
                    field(
                      "invitees",
                      fields.invitees.map((item, i) =>
                        i === index ? { ...item, label: e.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            </div>
            <button
              type="button"
              className="invitation-secondary"
              disabled={fields.invitees.length === 1}
              onClick={() => {
                setKeys((current) => current.filter((_, i) => i !== index));
                field(
                  "invitees",
                  fields.invitees.filter((_, i) => i !== index),
                );
                requestAnimationFrame(() =>
                  document
                    .getElementById(`invitee-${Math.max(0, index - 1)}`)
                    ?.focus(),
                );
              }}
            >
              Remove invitee {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="invitation-secondary"
          onClick={() => {
            const key = nextKey.current++;
            setKeys((current) => [...current, key]);
            const index = fields.invitees.length;
            field("invitees", [
              ...fields.invitees,
              { fullName: "", category: "ADULT", label: "" },
            ]);
            requestAnimationFrame(() =>
              document.getElementById(`invitee-${index}`)?.focus(),
            );
          }}
        >
          Add invitee
        </button>
      </fieldset>
      <p role="status" aria-live="polite">
        {pending ? "Creating invitation… Please wait." : ""}
      </p>
      <button type="submit" disabled={pending || locked}>
        {pending ? "Creating…" : "Create invitation"}
      </button>
    </form>
  );
}
