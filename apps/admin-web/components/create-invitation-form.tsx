"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
import {
  createInvitation,
  UNCERTAIN_CREATE,
} from "../src/invitations/create-invitation";
import {
  prepareInvitation,
  deadlineToIso,
  type CreateFields,
  type FormErrors,
} from "../src/invitations/form-state";
import {
  CREATE_PENDING_KEY,
  initialCreateFields,
  weddingEventIssue,
  withGuestDisplayName,
} from "../src/invitations/create-workflow";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { InvitationShareLink } from "./invitation-share-link";

const STORAGE_UNAVAILABLE =
  "Browser submission protection is unavailable. Enable session storage for this site and reload before creating an invitation.";

export function CreateInvitationForm({
  events,
  csrfToken,
}: {
  events: AdminEventsResponse["events"];
  csrfToken: string;
}) {
  const [fields, setFields] = useState<CreateFields>(() =>
    initialCreateFields(events),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState<"list" | "reload" | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [created, setCreated] = useState<{
    invitationId: string;
    publicUrl: string;
  } | null>(null);
  const [keys, setKeys] = useState([0]);
  const nextKey = useRef(1);
  const busy = useRef(false);
  const token = useRef(csrfToken);
  const formRef = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const prerequisite = weddingEventIssue(events);
  const event = events[0];
  const [deadlineDate = "", deadlineTime = ""] = fields.deadline.split("T");
  const deadlineIso = fields.deadline ? deadlineToIso(fields.deadline) : null;

  // A non-secret marker survives reload/navigation while a non-idempotent
  // request may have committed. It contains no guest data, token, or URL.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        if (sessionStorage.getItem(CREATE_PENDING_KEY)) {
          setLocked(true);
          setRecovery("list");
          setMessage(UNCERTAIN_CREATE);
        }
      } catch {
        setLocked(true);
        setMessage(STORAGE_UNAVAILABLE);
      }
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  function field<K extends keyof CreateFields>(key: K, value: CreateFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors({});
    if (!recovery) setMessage("");
  }
  function deadline(date: string, time: string) {
    field("deadline", date || time ? `${date}T${time}` : "");
  }
  function feedback(text: string) {
    setMessage(text);
    requestAnimationFrame(() => {
      notice.current?.focus();
      notice.current?.scrollIntoView({ block: "nearest" });
    });
  }
  function clearPendingMarker() {
    try {
      sessionStorage.removeItem(CREATE_PENDING_KEY);
    } catch {
      /* memory guard remains */
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current || locked || checking || prerequisite) return;
    try {
      if (sessionStorage.getItem(CREATE_PENDING_KEY)) {
        setLocked(true);
        setRecovery("list");
        feedback(UNCERTAIN_CREATE);
        return;
      }
    } catch {
      setLocked(true);
      feedback(STORAGE_UNAVAILABLE);
      return;
    }
    const prepared = prepareInvitation(withGuestDisplayName(fields), events);
    // The primary guest field explains the derived backend display name.
    if (prepared.errors.displayName && !fields.displayName.trim())
      delete prepared.errors.displayName;
    setErrors(prepared.errors);
    if (Object.keys(prepared.errors).length) {
      setMessage("Please check the highlighted guest information.");
      requestAnimationFrame(() => {
        const invalid = formRef.current?.querySelector<HTMLElement>(
          '[aria-invalid="true"]:not(:disabled)',
        );
        const details = invalid?.closest("details");
        if (details) details.open = true;
        invalid?.focus();
      });
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      sessionStorage.setItem(CREATE_PENDING_KEY, "pending");
    } catch {
      busy.current = false;
      setPending(false);
      setLocked(true);
      feedback(STORAGE_UNAVAILABLE);
      return;
    }
    const result = await createInvitation(prepared.body, token.current);
    setPending(false);
    if (result.kind === "uncertain") {
      setLocked(true);
      setRecovery("list");
      feedback(UNCERTAIN_CREATE);
      return;
    }
    clearPendingMarker();
    if (result.kind === "created") {
      setLocked(true);
      setCreated({
        invitationId: result.invitationId,
        publicUrl: result.publicUrl,
      });
      feedback("Invitation created.");
      return;
    }
    if (result.kind === "session-ended") {
      window.location.replace(SESSION_ENDED_PATH);
      return;
    }
    busy.current = false;
    if (result.kind === "reload") {
      setLocked(true);
      setRecovery("reload");
      feedback(result.message);
    } else if (result.kind === "csrf") {
      token.current = result.csrfToken;
      feedback(
        "Your session was refreshed. No invitation was created. Review the form and select Create invitation again.",
      );
    } else feedback(result.message);
  }
  const errorProps = (id: string) => ({
    "aria-invalid": Boolean(errors[id]),
    "aria-describedby": errors[id] ? id + "-error" : undefined,
  });
  const error = (id: string) =>
    errors[id] ? (
      <p className="field-error" id={id + "-error"}>
        {errors[id]}
      </p>
    ) : null;

  if (created)
    return (
      <section className="invitation-created" aria-labelledby="created-title">
        <div ref={notice} tabIndex={-1}>
          <span className="creation-confirmation" aria-hidden="true">
            ✓
          </span>
          <p className="eyebrow">Ready to share</p>
          <h2 id="created-title">Invitation created</h2>
          <p role="status">
            One invitation was confirmed by the server. Copy its link to send to
            your guests.
          </p>
        </div>
        <InvitationShareLink publicUrl={created.publicUrl} />
        <div className="invitation-actions">
          <Link
            className="invitation-secondary"
            href={"/invitations/" + created.invitationId}
            prefetch={false}
          >
            Manage this invitation
          </Link>
          <button
            className="invitation-secondary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Create another invitation
          </button>
          <Link href="/invitations" prefetch={false}>
            Back to invitations
          </Link>
        </div>
      </section>
    );

  if (prerequisite)
    return (
      <section className="dashboard-error" role="alert">
        <h2>Wedding event unavailable</h2>
        <p>{prerequisite}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload wedding event
        </button>
        {" · "}
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </section>
    );

  return (
    <form
      className="invitation-create"
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label="Create invitation"
      aria-busy={pending || checking}
    >
      <div ref={notice} tabIndex={-1} role={message ? "alert" : undefined}>
        {message && <p className="notice">{message}</p>}
        {recovery && (
          <div className="create-recovery">
            <a
              className="dashboard-retry"
              href={recovery === "list" ? "/invitations" : "/invitations/new"}
              target={recovery === "list" ? "_blank" : undefined}
              rel="noopener noreferrer"
            >
              {recovery === "list"
                ? "Check invitations list"
                : "Reload wedding event and session"}
            </a>
            {recovery === "list" && (
              <>
                <p>
                  Do not submit this draft again. The earlier request may still
                  complete. Check the list and the guest details first.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I checked the list and want to start a separate invitation.
                </label>
                <button
                  className="invitation-secondary"
                  type="button"
                  disabled={!reviewed}
                  onClick={() => {
                    clearPendingMarker();
                    window.location.reload();
                  }}
                >
                  Start a separate invitation
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <section className="create-event-summary" aria-label="Wedding event">
        <h2>Your wedding event</h2>
        <p>
          <strong>{event!.name}</strong> is included automatically.
        </p>
        {event!.startsAt && (
          <p>
            {new Intl.DateTimeFormat("en-GB", {
              dateStyle: "long",
              timeStyle: "short",
              timeZone: "Asia/Jakarta",
            }).format(new Date(event!.startsAt))}{" "}
            WIB
          </p>
        )}
        {event!.venueName && <p>{event!.venueName}</p>}
        {(!event!.startsAt || !event!.venueName || !event!.address) && (
          <p className="hint">
            Some wedding time or location details are not configured. Ask the
            operator to review this existing event before sharing invitations.
            No event details are changed here.
          </p>
        )}
      </section>

      <div className="create-columns">
        <div className="create-fields">
          <fieldset disabled={pending || locked || checking}>
            <legend>Guest information</legend>
            <p className="create-step">01 / The guest</p>
            <h2>Who are you inviting?</h2>
            <p className="hint">
              Add one row for each named person sharing this link. The first
              guest&apos;s name is also the invitation name unless you add a
              household name below.
            </p>
            {error("invitees")}
            {fields.invitees.map((row, index) => (
              <fieldset key={keys[index]} className="invitee-row">
                <legend>Guest {index + 1}</legend>
                <div className="field">
                  <label htmlFor={"invitee-" + index}>
                    Full name (required)
                  </label>
                  <input
                    id={"invitee-" + index}
                    required
                    autoComplete="off"
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
                    {...errorProps("invitee-" + index)}
                  />
                  {error("invitee-" + index)}
                </div>
                <details>
                  <summary>Guest options (adult by default)</summary>
                  <div className="create-grid">
                    <div className="field">
                      <label htmlFor={"category-" + index}>Category</label>
                      <select
                        id={"category-" + index}
                        value={row.category}
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
                        {...errorProps("category-" + index)}
                      >
                        <option value="ADULT">Adult</option>
                        <option value="CHILD">Child</option>
                      </select>
                      {error("category-" + index)}
                    </div>
                    <div className="field">
                      <label htmlFor={"label-" + index}>Label (optional)</label>
                      <input
                        id={"label-" + index}
                        value={row.label ?? ""}
                        onChange={(e) =>
                          field(
                            "invitees",
                            fields.invitees.map((item, i) =>
                              i === index
                                ? { ...item, label: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                </details>
                {fields.invitees.length > 1 && (
                  <button
                    type="button"
                    className="invitation-secondary"
                    disabled={fields.invitees.length === 1}
                    onClick={() => {
                      setKeys((current) =>
                        current.filter((_, i) => i !== index),
                      );
                      field(
                        "invitees",
                        fields.invitees.filter((_, i) => i !== index),
                      );
                      requestAnimationFrame(() =>
                        document
                          .getElementById("invitee-" + Math.max(0, index - 1))
                          ?.focus(),
                      );
                    }}
                  >
                    Remove guest {index + 1}
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              className="invitation-secondary"
              onClick={() => {
                setKeys((current) => [...current, nextKey.current++]);
                const index = fields.invitees.length;
                field("invitees", [
                  ...fields.invitees,
                  { fullName: "", category: "ADULT", label: "" },
                ]);
                requestAnimationFrame(() =>
                  document.getElementById("invitee-" + index)?.focus(),
                );
              }}
            >
              Add guest
            </button>
            <details className="create-household">
              <summary>Household name (optional)</summary>
              <div className="field">
                <label htmlFor="displayName">
                  Invitation / household name (optional)
                </label>
                <input
                  id="displayName"
                  value={fields.displayName}
                  onChange={(e) => field("displayName", e.target.value)}
                  {...errorProps("displayName")}
                  aria-describedby={`displayName-help${errors.displayName ? " displayName-error" : ""}`}
                />
                <p id="displayName-help" className="hint">
                  Leave blank to use the first guest&apos;s name. For a family,
                  enter the household name here.
                </p>
                {error("displayName")}
              </div>
            </details>
          </fieldset>

          <fieldset
            disabled={pending || locked || checking}
            className="create-settings"
          >
            <legend>Optional invitation settings</legend>
            <p className="create-step">02 / The invitation</p>
            <h2>A few thoughtful details</h2>
            <details>
              <summary>
                Greeting, additional guests, children and RSVP deadline
              </summary>
              <div className="field">
                <label htmlFor="greetingName">Greeting name</label>
                <input
                  id="greetingName"
                  value={fields.greetingName ?? ""}
                  onChange={(e) => field("greetingName", e.target.value)}
                />
                <p className="hint">
                  Optional salutation shown to the guest. Leave blank to use the
                  invitation / household name.
                </p>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={fields.allowPlusOne}
                  onChange={(e) => field("allowPlusOne", e.target.checked)}
                />
                Allow one plus-one guest
              </label>
              <div className="create-grid">
                <div className="field">
                  <label htmlFor="children">Maximum additional children</label>
                  <input
                    id="children"
                    type="number"
                    min={0}
                    step={1}
                    value={fields.children}
                    onChange={(e) => field("children", e.target.value)}
                    {...errorProps("children")}
                  />
                  {error("children")}
                  <p className="hint">
                    Extra children beyond any named child guests above.
                  </p>
                </div>
              </div>
              <fieldset className="create-deadline">
                <legend>RSVP deadline · Asia/Jakarta / WIB</legend>
                <p className="hint" id="deadline-help">
                  Leave both fields blank for no deadline. Otherwise choose a
                  date and time. RSVP closes at that selected minute in WIB
                  (UTC+07:00).
                </p>
                <div className="create-grid">
                  <div className="field">
                    <label htmlFor="deadline">Deadline date (WIB)</label>
                    <input
                      id="deadline"
                      type="date"
                      value={deadlineDate}
                      onChange={(e) => deadline(e.target.value, deadlineTime)}
                      {...errorProps("deadline")}
                      aria-describedby={`deadline-help${errors.deadline ? " deadline-error" : ""}`}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="deadline-time">Deadline time (WIB)</label>
                    <input
                      id="deadline-time"
                      type="time"
                      step={60}
                      value={deadlineTime}
                      onChange={(e) => deadline(deadlineDate, e.target.value)}
                      {...errorProps("deadline")}
                      aria-describedby={`deadline-help${errors.deadline ? " deadline-error" : ""}`}
                    />
                  </div>
                </div>
                {error("deadline")}
              </fieldset>
              <div className="field">
                <label htmlFor="notes">Internal notes</label>
                <textarea
                  id="notes"
                  rows={3}
                  value={fields.notes ?? ""}
                  onChange={(e) => field("notes", e.target.value)}
                />
                <p className="hint">Visible only to the administrator.</p>
              </div>
            </details>
          </fieldset>
        </div>
        <aside
          className="create-sidebar"
          aria-label="Invitation preview and review"
        >
          <p className="create-step">03 / Review</p>
          <figure
            className="create-preview"
            aria-label="Illustrative guest-facing preview"
          >
            <Image
              src="/assets/wedding-cover.webp"
              alt="Jo and Venta together in the garden"
              width={768}
              height={1024}
              sizes="(max-width: 1100px) 72px, 400px"
            />
            <div className="create-preview-copy">
              <p>The wedding of</p>
              <h2>Jo &amp; Venta</h2>
              <p>A personal invitation for</p>
              <strong>
                {fields.greetingName?.trim() ||
                  withGuestDisplayName(fields).displayName ||
                  "Your guest"}
              </strong>
            </div>
          </figure>
          <section className="create-review" aria-label="Review invitation">
            <h2>Review and create</h2>
            <dl className="create-summary">
              <div>
                <dt>Named guests</dt>
                <dd>
                  {
                    fields.invitees.filter((guest) => guest.fullName.trim())
                      .length
                  }
                </dd>
              </div>
              <div>
                <dt>Greeting</dt>
                <dd>
                  {fields.greetingName?.trim() ||
                    withGuestDisplayName(fields).displayName ||
                    "Invitation name"}
                </dd>
              </div>
              <div>
                <dt>Invitation name</dt>
                <dd>
                  {withGuestDisplayName(fields).displayName ||
                    "Enter a guest name"}
                </dd>
              </div>
              <div>
                <dt>Plus-one</dt>
                <dd>
                  {fields.allowPlusOne ? "One guest allowed" : "Not included"}
                </dd>
              </div>
              <div>
                <dt>Additional children</dt>
                <dd>{fields.children || "0"}</dd>
              </div>
              <div>
                <dt>Wedding event</dt>
                <dd>{event!.name}</dd>
              </div>
              <div>
                <dt>RSVP deadline</dt>
                <dd>
                  {!fields.deadline
                    ? "No deadline"
                    : deadlineIso
                      ? `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(deadlineIso))} WIB`
                      : "Choose a valid date and time"}
                </dd>
              </div>
            </dl>
            <p className="hint">
              Creates one invitation for the named guests and the extra
              allowances above. A household or greeting name does not add guest
              places. Share the link after server confirmation.
            </p>
          </section>
          <p role="status" aria-live="polite">
            {checking
              ? "Checking previous submission…"
              : pending
                ? "Creating invitation… Please wait."
                : ""}
          </p>
          <div className="invitation-actions">
            <button type="submit" disabled={pending || locked || checking}>
              {pending ? "Creating…" : "Create invitation"}
            </button>
            <Link href="/invitations" prefetch={false}>
              Cancel
            </Link>
          </div>
        </aside>
      </div>
    </form>
  );
}
