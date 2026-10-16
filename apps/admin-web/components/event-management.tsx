"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import * as api from "../src/events/client";
const empty = (): api.EventFields => ({
  slug: "",
  name: "",
  description: null,
  startsAt: null,
  endsAt: null,
  venueName: null,
  address: null,
  googleMapsUrl: null,
  displayOrder: 0,
  isActive: true,
});
const messages: Record<string, string> = {
  EVENT_VERSION_CONFLICT:
    "Another editor changed this event. Your draft is preserved. Reload saved events before editing again.",
  EVENT_IN_USE:
    "This event is already used. Its slug and active status cannot be changed.",
  EVENT_SCHEDULE_LOCKED:
    "Check-in has started. The event schedule cannot be changed.",
  EVENT_UNIQUE_CONFLICT:
    "Slug or display order is already used. Choose a different value.",
  VALIDATION_ERROR:
    "Check the fields: end must follow start, and Maps must be a supported HTTPS Google Maps link.",
  CSRF_INVALID: "Session security refreshed. Review the form and save again.",
  FORBIDDEN: "Only an OWNER can manage events.",
};
export function EventManagement({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [csrf, setCsrf] = useState(csrfToken);
  const [items, setItems] = useState<api.ManagedEvent[]>([]);
  const [saved, setSaved] = useState<api.ManagedEvent | null>(null);
  const [draft, setDraft] = useState<api.EventFields>(empty);
  const [busy, setBusy] = useState(true);
  const [blocked, setBlocked] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("Loading saved events…");
  const used = saved ? Object.values(saved.usage).some((n) => n > 0) : false;
  const scheduleLocked = !!saved && saved.usage.checkins > 0;
  function loadRow(row: api.ManagedEvent | null, rows = items) {
    setSaved(row);
    if (row) {
      setDraft({
        slug: row.slug,
        name: row.name,
        description: row.description,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        venueName: row.venueName,
        address: row.address,
        googleMapsUrl: row.googleMapsUrl,
        displayOrder: row.displayOrder,
        isActive: row.isActive,
      });
    } else
      setDraft({
        ...empty(),
        displayOrder: rows.length
          ? Math.min(
              2147483647,
              Math.max(...rows.map((r) => r.displayOrder)) + 1,
            )
          : 0,
      });
    setDirty(false);
  }
  function fail(result: Exclude<api.Result<unknown>, { kind: "ok" }>) {
    if (result.kind === "uncertain") {
      setBlocked(true);
      setMessage(
        "Save outcome is unknown. Do not retry. Reload saved events to check whether it was saved; your draft is still shown.",
      );
    } else {
      if (result.csrfToken) setCsrf(result.csrfToken);
      if (result.code === "UNAUTHENTICATED") router.replace(SESSION_ENDED_PATH);
      if (
        [
          "EVENT_VERSION_CONFLICT",
          "EVENT_IN_USE",
          "EVENT_SCHEDULE_LOCKED",
          "FORBIDDEN",
          "NOT_FOUND",
        ].includes(result.code)
      )
        setBlocked(true);
      setMessage(
        messages[result.code] ??
          "Saved state could not be loaded. Reload saved events to continue.",
      );
    }
  }
  useEffect(() => {
    let active = true;
    void api.list().then((result) => {
      if (!active) return;
      if (result.kind === "ok") {
        setItems(result.data.items);
        setBlocked(false);
        setMessage("Saved events loaded.");
        loadRow(null, result.data.items);
      } else fail(result);
      setBusy(false);
    });
    return () => {
      active = false;
    };
    // Initial session-bound load only; later reloads are explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function reload() {
    if (
      dirty &&
      !window.confirm("Reload saved events and discard the draft shown here?")
    )
      return;
    setBusy(true);
    setBlocked(true);
    const result = await api.list();
    if (result.kind === "ok") {
      setItems(result.data.items);
      loadRow(
        result.data.items.find((r) => r.id === saved?.id) ?? null,
        result.data.items,
      );
      setBlocked(false);
      setMessage("Saved events loaded.");
    } else fail(result);
    setBusy(false);
  }
  function change<K extends keyof api.EventFields>(
    key: K,
    value: api.EventFields[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }
  return (
    <section
      className="panel event-content-workspace event-management-workspace"
      aria-label="Event management editor"
    >
      <p>
        Times use WIB (Asia/Jakarta). Saved changes appear to guests on their
        next page load. An event used by invitations keeps its slug and active
        status; its schedule is locked after check-in. Events cannot be deleted
        here.
      </p>
      <p role="status">{message}</p>
      <button type="button" disabled={busy} onClick={() => void reload()}>
        Reload saved events
      </button>
      <label htmlFor="managed-event-picker">Event to edit</label>
      <select
        id="managed-event-picker"
        disabled={busy || blocked}
        value={saved?.id ?? ""}
        onChange={(e) => {
          if (
            dirty &&
            !window.confirm("Discard the current draft and switch events?")
          )
            return;
          loadRow(items.find((r) => r.id === e.target.value) ?? null);
          setMessage("Saved state loaded.");
        }}
      >
        <option value="">New event</option>
        {items.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.isActive ? "" : " (inactive)"}
          </option>
        ))}
      </select>
      {saved ? (
        <p>
          Version {saved.version} · {saved.usage.invitations} invitation links ·{" "}
          {saved.usage.rsvps} RSVP selections · {saved.usage.checkins} check-ins
        </p>
      ) : null}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || blocked) return;
          setBusy(true);
          setMessage("Saving event…");
          const result = await api.save(draft, csrf, saved);
          if (result.kind === "ok") {
            const rows = [
              ...items.filter((r) => r.id !== result.data.id),
              result.data,
            ].sort((a, b) => a.displayOrder - b.displayOrder);
            setItems(rows);
            loadRow(result.data, rows);
            setMessage("Event saved.");
          } else fail(result);
          setBusy(false);
        }}
      >
        <fieldset disabled={busy || blocked}>
          <legend>{saved ? "Edit event" : "Create event"}</legend>
          <label>
            Event name
            <input
              required
              maxLength={200}
              value={draft.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <label>
            Slug
            <input
              required
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              disabled={used}
              value={draft.slug}
              onChange={(e) => change("slug", e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={2000}
              value={draft.description ?? ""}
              onChange={(e) => change("description", e.target.value || null)}
            />
          </label>
          <label>
            Start (WIB)
            <input
              type="datetime-local"
              step="0.001"
              disabled={scheduleLocked}
              value={api.toWib(draft.startsAt)}
              onChange={(e) => change("startsAt", api.fromWib(e.target.value))}
            />
          </label>
          <label>
            End (WIB)
            <input
              type="datetime-local"
              step="0.001"
              disabled={scheduleLocked}
              value={api.toWib(draft.endsAt)}
              onChange={(e) => change("endsAt", api.fromWib(e.target.value))}
            />
          </label>
          <label>
            Venue name
            <input
              maxLength={300}
              value={draft.venueName ?? ""}
              onChange={(e) => change("venueName", e.target.value || null)}
            />
          </label>
          <label>
            Address
            <textarea
              maxLength={2000}
              value={draft.address ?? ""}
              onChange={(e) => change("address", e.target.value || null)}
            />
          </label>
          <label>
            Google Maps URL
            <input
              type="url"
              maxLength={2048}
              value={draft.googleMapsUrl ?? ""}
              onChange={(e) => change("googleMapsUrl", e.target.value || null)}
            />
          </label>
          <label>
            Display order
            <input
              type="number"
              required
              min={0}
              max={2147483647}
              step={1}
              value={draft.displayOrder}
              onChange={(e) => change("displayOrder", Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              disabled={used}
              checked={draft.isActive}
              onChange={(e) => change("isActive", e.target.checked)}
            />
            Active event
          </label>
          <button type="submit" disabled={!dirty}>
            Save event
          </button>
        </fieldset>
      </form>
    </section>
  );
}
