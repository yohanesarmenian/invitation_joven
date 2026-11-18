"use client";
import { ActionFeedback } from "./action-feedback";
import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type {
  AdminEventsResponse,
  AdminInvitationDetailResponse,
  CreateAdminInviteeRequest,
  UpdateAdminInviteeRequest,
} from "@wedding-invitation/api-client/src/index";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import {
  createInvitee,
  deleteInvitee,
  replaceInvitationEvents,
  updateInvitee,
  type DeleteInviteeResult,
  type InviteeMutationResult,
  type ReplaceInvitationEventsResult,
} from "../src/invitations/lifecycle";

type Invitation = AdminInvitationDetailResponse["invitation"];
type Invitee = Invitation["invitees"][number];
type EventOption = AdminEventsResponse["events"][number];
type Category = Invitee["category"];
type InviteeFields = { fullName: string; category: Category; label: string };
type InviteeErrors = Partial<Record<keyof InviteeFields, string>>;
type InviteeDialog =
  | { mode: "create"; fields: InviteeFields }
  | { mode: "edit"; invitee: Invitee; fields: InviteeFields };

const emptyFields: InviteeFields = {
  fullName: "",
  category: "ADULT",
  label: "",
};
const subscribeToReadiness = () => () => {};
const clientReady = () => true;
const serverNotReady = () => false;
const reloadDetail = (invitationId: string) => `/invitations/${invitationId}`;
const nullable = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

function prepareInvitee(
  fields: InviteeFields,
  expectedUpdatedAt?: string,
): {
  body: CreateAdminInviteeRequest | UpdateAdminInviteeRequest;
  errors: InviteeErrors;
} {
  const errors: InviteeErrors = {};
  if (!fields.fullName.trim()) errors.fullName = "Enter a full name.";
  return {
    errors,
    body:
      expectedUpdatedAt === undefined
        ? {
            fullName: fields.fullName.trim(),
            category: fields.category,
            label: nullable(fields.label),
          }
        : {
            expectedUpdatedAt,
            fullName: fields.fullName.trim(),
            category: fields.category,
            label: nullable(fields.label),
          },
  };
}

function nextDetail(invitationId: string, query: string) {
  window.location.replace(`${reloadDetail(invitationId)}?${query}=1`);
}

function mutationMessage(
  result:
    InviteeMutationResult | DeleteInviteeResult | ReplaceInvitationEventsResult,
) {
  if (result.kind === "not-found") return "Invitation data was not found.";
  if (result.kind === "validation")
    return "The request was not accepted. Review the values and submit again.";
  if (result.kind === "rejected") return result.message;
  return "The result could not be confirmed. Reload the detail before trying another change.";
}

function eventOptions(
  events: EventOption[],
  invitation: Invitation,
): EventOption[] {
  const merged = new Map<string, EventOption>();
  for (const event of [
    ...events,
    ...invitation.eligibility.map((e) => e.event),
  ])
    merged.set(event.id, event);
  return [...merged.values()].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
}

export function InviteeEventManagement({
  csrfToken,
  events,
  invitation,
}: {
  csrfToken: string;
  events: EventOption[];
  invitation: Invitation;
}) {
  const token = useRef(csrfToken);
  const notice = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(false);
  const [pending, setPending] = useState<
    "invitee" | "delete" | "events" | null
  >(null);
  const [dialog, setDialog] = useState<InviteeDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Invitee | null>(null);
  const [errors, setErrors] = useState<InviteeErrors>({});
  const options = useMemo(
    () => eventOptions(events, invitation),
    [events, invitation],
  );
  const initialEventIds = useMemo(
    () => invitation.eligibility.map(({ event }) => event.id),
    [invitation],
  );
  const [selectedEvents, setSelectedEvents] = useState(
    () => new Set(initialEventIds),
  );
  // Server HTML must not offer actions before their event handlers attach.
  const hydrated = useSyncExternalStore(
    subscribeToReadiness,
    clientReady,
    serverNotReady,
  );
  const locked = !hydrated || reload || invitation.status !== "ACTIVE";

  function feedback(text: string, requiresReload = false) {
    setMessage(text);
    setReload(requiresReload);
    requestAnimationFrame(() => notice.current?.focus());
  }
  function handleCommon(
    result:
      | InviteeMutationResult
      | DeleteInviteeResult
      | ReplaceInvitationEventsResult,
  ) {
    if (result.kind === "session-ended") {
      window.location.replace(SESSION_ENDED_PATH);
      return true;
    }
    if (result.kind === "csrf") {
      token.current = result.csrfToken;
      feedback(result.message);
      return true;
    }
    return false;
  }
  function openCreate() {
    setErrors({});
    setDialog({ mode: "create", fields: emptyFields });
  }
  function openEdit(invitee: Invitee) {
    setErrors({});
    setDialog({
      mode: "edit",
      invitee,
      fields: {
        fullName: invitee.fullName,
        category: invitee.category,
        label: invitee.label ?? "",
      },
    });
  }
  function setField<K extends keyof InviteeFields>(
    key: K,
    value: InviteeFields[K],
  ) {
    setDialog((current) =>
      current
        ? { ...current, fields: { ...current.fields, [key]: value } }
        : current,
    );
  }
  async function submitInvitee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || busy.current || locked) return;
    const prepared = prepareInvitee(
      dialog.fields,
      dialog.mode === "edit" ? dialog.invitee.updatedAt : undefined,
    );
    setErrors(prepared.errors);
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
    setPending("invitee");
    const result =
      dialog.mode === "create"
        ? await createInvitee(
            invitation.id,
            prepared.body as CreateAdminInviteeRequest,
            token.current,
          )
        : await updateInvitee(
            dialog.invitee.id,
            prepared.body as UpdateAdminInviteeRequest,
            token.current,
          );
    setPending(null);
    busy.current = false;
    if (handleCommon(result)) return;
    if (result.kind === "created") {
      nextDetail(invitation.id, "inviteeCreated");
      return;
    }
    if (result.kind === "updated") {
      nextDetail(invitation.id, "inviteeUpdated");
      return;
    }
    if (result.kind === "conflict") {
      feedback(
        dialog.mode === "edit"
          ? "This invitee changed elsewhere. Your edits are still here. Reload latest detail before replacing them."
          : "The invitee could not be added because the current invitation state conflicts. Reload latest detail before trying again.",
      );
      return;
    }
    feedback(mutationMessage(result), result.kind === "uncertain");
  }
  async function confirmDelete() {
    if (!deleteTarget || busy.current || locked) return;
    busy.current = true;
    setPending("delete");
    const result = await deleteInvitee(deleteTarget.id, token.current);
    setPending(null);
    busy.current = false;
    if (handleCommon(result)) return;
    if (result.kind === "deleted") {
      nextDetail(invitation.id, "inviteeDeleted");
      return;
    }
    if (result.kind === "conflict") {
      feedback(
        "This invitee is referenced by RSVP attendance and cannot be deleted.",
      );
      setDeleteTarget(null);
      return;
    }
    feedback(mutationMessage(result), result.kind === "uncertain");
  }
  function toggleEvent(eventId: string, checked: boolean) {
    setSelectedEvents((current) => {
      const next = new Set(current);
      if (checked) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
  }
  async function saveEvents() {
    if (busy.current || locked) return;
    const selected = options
      .filter((event) => selectedEvents.has(event.id))
      .map((event) => event.id);
    busy.current = true;
    setPending("events");
    const result = await replaceInvitationEvents(
      invitation.id,
      { eventIds: selected },
      token.current,
    );
    setPending(null);
    busy.current = false;
    if (handleCommon(result)) return;
    if (result.kind === "updated") {
      nextDetail(invitation.id, "eventsUpdated");
      return;
    }
    if (result.kind === "conflict") {
      feedback(
        "These event assignments conflict with current RSVP data. Your selection is still here; reload latest detail before replacing it.",
      );
      return;
    }
    feedback(mutationMessage(result), result.kind === "uncertain");
  }
  const errorProps = (id: keyof InviteeFields) => ({
    "aria-invalid": Boolean(errors[id]),
    "aria-describedby": errors[id] ? `${id}-error` : undefined,
  });
  const sortedInvitees = [...invitation.invitees].sort(
    (a, b) =>
      a.displayOrder - b.displayOrder || a.fullName.localeCompare(b.fullName),
  );

  return (
    <>
      <div ref={notice} tabIndex={-1}>
        {message && <ActionFeedback tone="error">{message}</ActionFeedback>}
        {reload && (
          <a className="dashboard-retry" href={reloadDetail(invitation.id)}>
            Reload latest detail
          </a>
        )}
      </div>
      {invitation.status !== "ACTIVE" && (
        <p className="hint">Archived invitations cannot be changed.</p>
      )}
      <section className="detail-section">
        <div className="section-heading management-heading">
          <div>
            <h2>Invitees</h2>
            <p>Add, edit, or delete named invitees for this invitation.</p>
          </div>
          <button
            disabled={locked || pending !== null}
            onClick={openCreate}
            type="button"
          >
            Add invitee
          </button>
        </div>
        <div className="detail-table-scroll">
          <table className="detail-table invitee-management-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Category</th>
                <th scope="col">Label</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedInvitees.map((invitee) => (
                <tr key={invitee.id}>
                  <th scope="row">{invitee.fullName}</th>
                  <td>{invitee.category === "ADULT" ? "Adult" : "Child"}</td>
                  <td>{invitee.label ?? "None"}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="invitation-secondary"
                        disabled={locked || pending !== null}
                        onClick={() => openEdit(invitee)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="danger-secondary"
                        disabled={locked || pending !== null}
                        onClick={() => setDeleteTarget(invitee)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Eligible events</h2>
          <p>Save sends the complete selected event set.</p>
        </div>
        <div className="event-management-list">
          {options.map((event) => {
            const checked = selectedEvents.has(event.id);
            const disabled = locked || (!event.isActive && !checked);
            return (
              <label className="checkbox-label" key={event.id}>
                <input
                  checked={checked}
                  disabled={disabled || pending === "events"}
                  onChange={(change) =>
                    toggleEvent(event.id, change.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  {event.name}
                  <span className="event-state">
                    {event.isActive
                      ? "Active event"
                      : checked
                        ? "Inactive, currently eligible"
                        : "Inactive"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <p role="status" aria-live="polite">
          {pending === "events" ? "Saving event eligibility..." : ""}
        </p>
        <div className="form-actions">
          <button
            disabled={locked || pending !== null}
            onClick={saveEvents}
            type="button"
          >
            {pending === "events" ? "Saving..." : "Save event eligibility"}
          </button>
          <a href={reloadDetail(invitation.id)}>Reload latest detail</a>
        </div>
      </section>
      {dialog && (
        <div className="dialog-backdrop" role="presentation">
          <form
            aria-label={
              dialog.mode === "create" ? "Add invitee" : "Edit invitee"
            }
            className="confirm-dialog invitation-dialog-form"
            noValidate
            onSubmit={submitInvitee}
            ref={form}
          >
            <h2>{dialog.mode === "create" ? "Add invitee" : "Edit invitee"}</h2>
            <fieldset disabled={pending === "invitee" || locked}>
              <div className="field">
                <label htmlFor="invitee-fullName">Full name (required)</label>
                <input
                  id="invitee-fullName"
                  required
                  value={dialog.fields.fullName}
                  onChange={(event) => setField("fullName", event.target.value)}
                  {...errorProps("fullName")}
                />
                {errors.fullName && (
                  <p className="field-error" id="fullName-error">
                    {errors.fullName}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="invitee-category">Category</label>
                <select
                  id="invitee-category"
                  value={dialog.fields.category}
                  onChange={(event) =>
                    setField("category", event.target.value as Category)
                  }
                >
                  <option value="ADULT">Adult</option>
                  <option value="CHILD">Child</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="invitee-label">Label</label>
                <input
                  id="invitee-label"
                  value={dialog.fields.label}
                  onChange={(event) => setField("label", event.target.value)}
                />
              </div>
            </fieldset>
            <p role="status" aria-live="polite">
              {pending === "invitee" ? "Saving invitee..." : ""}
            </p>
            <div className="dialog-actions">
              <button disabled={locked || pending !== null} type="submit">
                {pending === "invitee"
                  ? "Saving..."
                  : dialog.mode === "create"
                    ? "Add invitee"
                    : "Save invitee"}
              </button>
              <button
                className="invitation-secondary"
                disabled={pending !== null}
                onClick={() => setDialog(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {deleteTarget && (
        <div className="dialog-backdrop" role="presentation">
          <div
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
            aria-labelledby="delete-invitee-title"
          >
            <h2 id="delete-invitee-title">Delete invitee</h2>
            <p>
              Delete {deleteTarget.fullName}? This cannot remove RSVP attendance
              that already references the invitee.
            </p>
            <div className="dialog-actions">
              <button
                className="danger-secondary"
                disabled={locked || pending !== null}
                onClick={confirmDelete}
                type="button"
              >
                {pending === "delete" ? "Deleting..." : "Delete invitee"}
              </button>
              <button
                className="invitation-secondary"
                disabled={pending !== null}
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
