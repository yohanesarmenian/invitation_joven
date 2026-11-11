"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  AdminInvitationDetailResponse,
  AdminRsvpDetailResponse,
  OverrideAdminRsvpRequest,
} from "@wedding-invitation/api-client/src/index";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import {
  overrideRsvp,
  UNCERTAIN_RSVP_OVERRIDE,
  type OverrideRsvpResult,
} from "../src/rsvps/override";

type Rsvp = AdminRsvpDetailResponse["rsvp"];
type Invitation = AdminInvitationDetailResponse["invitation"];
type OverrideStatus = OverrideAdminRsvpRequest["status"];
type AttendeeType = OverrideAdminRsvpRequest["attendees"][number]["type"];

type EventField = {
  attending: boolean;
  expectedAttendeeCount: string;
};
type FormErrors = Partial<{
  reason: string;
  attendee: string;
  eventSelections: string;
  dietaryNotes: string;
}>;

const REASON_LIMIT = 500;
const cpLength = (value: string) => Array.from(value).length;
const reloadDetail = (rsvpId: string) => `/rsvps/${rsvpId}`;
const nullableText = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export function codePointCount(value: string) {
  return cpLength(value);
}

function statusLabel(status: Rsvp["status"]) {
  return status === "ACCEPTED"
    ? "Accepted"
    : status === "DECLINED"
      ? "Declined"
      : "Pending";
}

function currentQuantity(rsvp: Rsvp, type: AttendeeType) {
  return rsvp.attendees
    .filter((attendee) => attendee.type === type)
    .reduce((total, attendee) => total + attendee.quantity, 0);
}

function attendeeTotal(
  selectedNamedIds: string[],
  plusOneQuantity: string,
  childQuantity: string,
) {
  return (
    selectedNamedIds.length +
    Number(plusOneQuantity || 0) +
    Number(childQuantity || 0)
  );
}

function selectedNamed(rsvp: Rsvp) {
  return rsvp.attendees
    .filter(
      (attendee) => attendee.type === "NAMED_INVITEE" && attendee.inviteeId,
    )
    .map((attendee) => attendee.inviteeId!)
    .filter((id, index, all) => all.indexOf(id) === index);
}

function namedInviteeOptions(invitation: Invitation, rsvp: Rsvp) {
  const rows = new Map<
    string,
    { id: string; label: string; inactive: boolean }
  >();
  for (const invitee of invitation.invitees)
    rows.set(invitee.id, {
      id: invitee.id,
      label: invitee.fullName,
      inactive: false,
    });
  for (const attendee of rsvp.attendees) {
    if (attendee.type !== "NAMED_INVITEE" || !attendee.inviteeId) continue;
    if (!rows.has(attendee.inviteeId))
      rows.set(attendee.inviteeId, {
        id: attendee.inviteeId,
        label: attendee.displayName ?? "Historical invitee",
        inactive: true,
      });
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function initialEvents(
  invitation: Invitation,
  rsvp: Rsvp,
): Record<string, EventField> {
  const current = new Map(
    rsvp.eventSelections.map((selection) => [selection.event.id, selection]),
  );
  const total = rsvp.attendees.reduce(
    (sum, attendee) => sum + attendee.quantity,
    0,
  );
  return Object.fromEntries(
    invitation.eligibility.map(({ event }) => {
      const persisted = current.get(event.id);
      return [
        event.id,
        {
          attending: persisted?.attending ?? false,
          expectedAttendeeCount: String(
            persisted?.expectedAttendeeCount ?? total,
          ),
        },
      ];
    }),
  );
}

export function prepareOverridePayload(input: {
  rsvp: Rsvp;
  status: OverrideStatus;
  selectedNamedIds: string[];
  plusOneQuantity: string;
  childQuantity: string;
  eventFields: Record<string, EventField>;
  dietaryNotes: string;
  overrideReason: string;
}): { body?: OverrideAdminRsvpRequest; errors: FormErrors } {
  const reason = input.overrideReason.trim();
  const errors: FormErrors = {};
  if (!reason) errors.reason = "Enter an override reason.";
  else if (cpLength(reason) > REASON_LIMIT)
    errors.reason = `Reason must be ${REASON_LIMIT} characters or fewer.`;

  const dietaryNotes = nullableText(input.dietaryNotes);
  if (dietaryNotes && cpLength(dietaryNotes) > REASON_LIMIT)
    errors.dietaryNotes = `Dietary notes must be ${REASON_LIMIT} characters or fewer.`;

  if (input.status === "DECLINED") {
    return Object.keys(errors).length
      ? { errors }
      : {
          errors,
          body: {
            attendees: [],
            dietaryNotes: null,
            eventSelections: [],
            expectedVersion: input.rsvp.version,
            overrideReason: reason,
            status: "DECLINED",
          },
        };
  }

  const plusOne = Number(input.plusOneQuantity || 0);
  const children = Number(input.childQuantity || 0);
  if (
    !Number.isSafeInteger(plusOne) ||
    plusOne < 0 ||
    !Number.isSafeInteger(children) ||
    children < 0
  )
    errors.attendee =
      "Attendee quantities must be whole numbers zero or greater.";

  const attendees: OverrideAdminRsvpRequest["attendees"] = [
    ...input.selectedNamedIds.map((inviteeId) => ({
      type: "NAMED_INVITEE" as const,
      inviteeId,
      quantity: 1,
    })),
  ];
  if (plusOne > 0)
    attendees.push({ type: "PLUS_ONE", inviteeId: null, quantity: plusOne });
  if (children > 0)
    attendees.push({
      type: "ADDITIONAL_CHILD",
      inviteeId: null,
      quantity: children,
    });
  if (!attendees.length)
    errors.attendee = "Select at least one attendee for an accepted RSVP.";

  const eventSelections = Object.entries(input.eventFields)
    .filter(([, field]) => field.attending)
    .map(([eventId, field]) => ({
      eventId,
      attending: true,
      expectedAttendeeCount: Number(field.expectedAttendeeCount || 0),
    }));
  if (!eventSelections.length)
    errors.eventSelections = "Select at least one eligible event.";
  if (
    eventSelections.some(
      (selection) =>
        !Number.isSafeInteger(selection.expectedAttendeeCount) ||
        selection.expectedAttendeeCount < 1,
    )
  )
    errors.eventSelections =
      "Expected attendee counts must be whole numbers of at least one.";

  return Object.keys(errors).length
    ? { errors }
    : {
        errors,
        body: {
          attendees,
          dietaryNotes,
          eventSelections,
          expectedVersion: input.rsvp.version,
          overrideReason: reason,
          status: "ACCEPTED",
        },
      };
}

function resultMessage(result: OverrideRsvpResult) {
  if (result.kind === "not-found")
    return "The RSVP or invitation was not found.";
  if (result.kind === "validation")
    return "The override was not accepted. Review attendee, event, capacity, and reason values before submitting again.";
  if (result.kind === "rejected") return result.message;
  return UNCERTAIN_RSVP_OVERRIDE;
}

export function RsvpOverrideForm({
  csrfToken,
  invitation,
  rsvp,
}: {
  csrfToken: string;
  invitation: Invitation;
  rsvp: Rsvp;
}) {
  const token = useRef(csrfToken);
  const notice = useRef<HTMLDivElement>(null);
  const firstInvalid = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<OverrideStatus>(
    rsvp.status === "DECLINED" ? "DECLINED" : "ACCEPTED",
  );
  const [selectedNamedIds, setSelectedNamedIds] = useState(() =>
    selectedNamed(rsvp),
  );
  const [plusOneQuantity, setPlusOneQuantity] = useState(() =>
    String(currentQuantity(rsvp, "PLUS_ONE")),
  );
  const [childQuantity, setChildQuantity] = useState(() =>
    String(currentQuantity(rsvp, "ADDITIONAL_CHILD")),
  );
  const [dietaryNotes, setDietaryNotes] = useState(rsvp.dietaryNotes ?? "");
  const [overrideReason, setOverrideReason] = useState("");
  const [eventFields, setEventFields] = useState(() =>
    initialEvents(invitation, rsvp),
  );
  const namedOptions = useMemo(
    () => namedInviteeOptions(invitation, rsvp),
    [invitation, rsvp],
  );
  const reasonCount = cpLength(overrideReason.trim());
  const dietaryCount = cpLength(dietaryNotes.trim());
  const attendeeCount = attendeeTotal(
    selectedNamedIds,
    plusOneQuantity,
    childQuantity,
  );
  const locked = reload || invitation.status !== "ACTIVE";

  function feedback(text: string, requiresReload = false) {
    setMessage(text);
    setReload(requiresReload);
    requestAnimationFrame(() => notice.current?.focus());
  }

  function toggleNamed(inviteeId: string, checked: boolean) {
    setSelectedNamedIds((current) =>
      checked
        ? [...current, inviteeId].filter(
            (id, index, all) => all.indexOf(id) === index,
          )
        : current.filter((id) => id !== inviteeId),
    );
  }

  function updateEvent(eventId: string, field: Partial<EventField>) {
    setEventFields((current) => ({
      ...current,
      [eventId]: { ...current[eventId]!, ...field },
    }));
  }

  function validate() {
    const prepared = prepareOverridePayload({
      rsvp,
      status,
      selectedNamedIds,
      plusOneQuantity,
      childQuantity,
      eventFields,
      dietaryNotes,
      overrideReason,
    });
    setErrors(prepared.errors);
    if (!prepared.body) {
      feedback("Review the highlighted fields.");
      requestAnimationFrame(() =>
        firstInvalid.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
          ?.focus(),
      );
    }
    return prepared.body;
  }

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || locked) return;
    if (!validate()) return;
    setConfirming(true);
  }

  async function submitOverride() {
    if (busy.current || locked) return;
    const body = validate();
    if (!body) {
      setConfirming(false);
      return;
    }
    busy.current = true;
    setPending(true);
    const result = await overrideRsvp(invitation.id, body, token.current);
    setPending(false);
    busy.current = false;
    if (result.kind === "overridden") {
      window.location.replace(`${reloadDetail(rsvp.id)}?rsvpOverridden=1`);
      return;
    }
    setConfirming(false);
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
      feedback(
        "This RSVP changed elsewhere. Your override values are still here. Reload current RSVP detail before deciding whether to replace them.",
        true,
      );
      return;
    }
    feedback(resultMessage(result), result.kind === "uncertain");
  }

  useEffect(() => {
    if (!confirming) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const cancel = document.getElementById("rsvp-override-cancel");
    cancel?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setConfirming(false);
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [confirming, pending]);

  return (
    <section className="detail-section lifecycle-section rsvp-override">
      <div className="section-heading management-heading">
        <div>
          <h2>OWNER RSVP override</h2>
          <p>
            Replace the current RSVP state using the latest saved response. The
            guest deadline may be bypassed; all other RSVP rules remain
            authoritative.
          </p>
        </div>
        <button
          disabled={locked || pending}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "Close override" : "Override RSVP"}
        </button>
      </div>
      {invitation.status !== "ACTIVE" && (
        <p className="hint">Archived invitations cannot be overridden.</p>
      )}
      <div ref={notice} tabIndex={-1} role={message ? "alert" : undefined}>
        {message && <p className="notice">{message}</p>}
        {reload && (
          <a className="dashboard-retry" href={reloadDetail(rsvp.id)}>
            Reload current RSVP detail
          </a>
        )}
      </div>
      {expanded && (
        <form
          aria-label="OWNER RSVP override"
          className="rsvp-override-form"
          noValidate
          onSubmit={requestConfirmation}
          ref={firstInvalid}
        >
          <p className="hint">
            Current guest note is read-only: {rsvp.guestNote ?? "No guest note"}
            .
          </p>
          <fieldset disabled={locked || pending}>
            <legend>Override status</legend>
            <label className="checkbox-label">
              <input
                checked={status === "ACCEPTED"}
                name="rsvp-status"
                onChange={() => setStatus("ACCEPTED")}
                type="radio"
              />
              <span>Accepted</span>
            </label>
            <label className="checkbox-label">
              <input
                checked={status === "DECLINED"}
                name="rsvp-status"
                onChange={() => setStatus("DECLINED")}
                type="radio"
              />
              <span>Declined</span>
            </label>
          </fieldset>
          {status === "ACCEPTED" && (
            <>
              <fieldset
                aria-describedby={
                  errors.attendee ? "attendee-error" : undefined
                }
                disabled={locked || pending}
              >
                <legend>Attendee composition</legend>
                {namedOptions.map((invitee) => (
                  <label className="checkbox-label" key={invitee.id}>
                    <input
                      checked={selectedNamedIds.includes(invitee.id)}
                      onChange={(event) =>
                        toggleNamed(invitee.id, event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>
                      {invitee.label}
                      <span className="event-state">
                        {invitee.inactive
                          ? "Snapshot invitee, no longer in current invitee list"
                          : "Named invitee"}
                      </span>
                    </span>
                  </label>
                ))}
                <div className="override-grid">
                  <label>
                    Plus-one quantity
                    <input
                      inputMode="numeric"
                      min="0"
                      step="1"
                      type="number"
                      value={plusOneQuantity}
                      onChange={(event) =>
                        setPlusOneQuantity(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Additional children
                    <input
                      inputMode="numeric"
                      min="0"
                      step="1"
                      type="number"
                      value={childQuantity}
                      onChange={(event) => setChildQuantity(event.target.value)}
                    />
                  </label>
                </div>
                <p className="hint">Selected attendee count: {attendeeCount}</p>
                {errors.attendee && (
                  <p className="field-error" id="attendee-error" role="alert">
                    {errors.attendee}
                  </p>
                )}
              </fieldset>
              <fieldset
                aria-describedby={
                  errors.eventSelections ? "eventSelections-error" : undefined
                }
                disabled={locked || pending}
              >
                <legend>Eligible event selections</legend>
                {invitation.eligibility.map(({ event }) => (
                  <div className="event-override-row" key={event.id}>
                    <label className="checkbox-label">
                      <input
                        checked={eventFields[event.id]?.attending ?? false}
                        disabled={!event.isActive}
                        onChange={(change) =>
                          updateEvent(event.id, {
                            attending: change.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                      <span>
                        {event.name}
                        <span className="event-state">
                          {event.isActive ? "Eligible event" : "Inactive event"}
                        </span>
                      </span>
                    </label>
                    <label>
                      Expected attendees
                      <input
                        disabled={
                          !(eventFields[event.id]?.attending ?? false) ||
                          !event.isActive
                        }
                        inputMode="numeric"
                        min="1"
                        step="1"
                        type="number"
                        value={
                          eventFields[event.id]?.expectedAttendeeCount ?? ""
                        }
                        onChange={(change) =>
                          updateEvent(event.id, {
                            expectedAttendeeCount: change.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
                {errors.eventSelections && (
                  <p
                    className="field-error"
                    id="eventSelections-error"
                    role="alert"
                  >
                    {errors.eventSelections}
                  </p>
                )}
              </fieldset>
              <label className="field">
                Dietary notes
                <textarea
                  aria-describedby={
                    errors.dietaryNotes ? "dietaryNotes-error" : "dietary-count"
                  }
                  aria-invalid={Boolean(errors.dietaryNotes)}
                  value={dietaryNotes}
                  onChange={(event) => setDietaryNotes(event.target.value)}
                  rows={3}
                />
              </label>
              <p className="hint" id="dietary-count">
                {dietaryCount}/{REASON_LIMIT} characters.
              </p>
              {errors.dietaryNotes && (
                <p className="field-error" id="dietaryNotes-error" role="alert">
                  {errors.dietaryNotes}
                </p>
              )}
            </>
          )}
          <label className="field">
            Override reason (required)
            <textarea
              aria-describedby={errors.reason ? "reason-error" : "reason-count"}
              aria-invalid={Boolean(errors.reason)}
              required
              rows={4}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
            />
          </label>
          <p className="hint" id="reason-count">
            {reasonCount}/{REASON_LIMIT} characters. Stored as current OWNER
            attribution, not audit history.
          </p>
          {errors.reason && (
            <p className="field-error" id="reason-error" role="alert">
              {errors.reason}
            </p>
          )}
          <p role="status" aria-live="polite">
            {pending ? "Submitting RSVP override..." : ""}
          </p>
          <div className="form-actions">
            <button disabled={locked || pending} type="submit">
              Review override
            </button>
            <a href={reloadDetail(rsvp.id)}>Reload current RSVP detail</a>
          </div>
        </form>
      )}
      {confirming && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-describedby="rsvp-override-confirm-desc"
            aria-labelledby="rsvp-override-confirm-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <h2 id="rsvp-override-confirm-title">Override RSVP</h2>
            <div id="rsvp-override-confirm-desc">
              <p>
                This will replace the RSVP attendance with the entered OWNER
                state, check that the saved response is still current, and store
                the override reason with current admin attribution.
              </p>
              <p>
                Check-in pass lifecycle may change. The guest deadline may be
                bypassed, but eligibility, capacity, active invitation, and
                concurrency safeguards still apply.
              </p>
              <p>Current status: {statusLabel(rsvp.status)}.</p>
            </div>
            <div className="dialog-actions">
              <button
                id="rsvp-override-cancel"
                className="invitation-secondary"
                disabled={pending}
                onClick={() => setConfirming(false)}
                type="button"
              >
                Cancel
              </button>
              <button disabled={pending} onClick={submitOverride} type="button">
                {pending ? "Overriding..." : "Override RSVP"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
