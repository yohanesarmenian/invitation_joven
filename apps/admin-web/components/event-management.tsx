"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import * as api from "../src/events/client";
import { eventHref, replaceEventSelection } from "../src/events/selection";
import { useEditorNavigation } from "../src/events/use-editor-navigation";
import {
  readWibMinuteAtSave,
  wibMinuteError,
  wibMinuteTimestamp,
  type WibMinuteEdit,
} from "../src/forms/wib-date-time";
import { ActionFeedback } from "./action-feedback";
import { WibDateTimeField } from "./wib-date-time-field";
import { EventFacts, EventReadiness } from "./event-overview";

type ScheduleField = "startsAt" | "endsAt";
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
    "Saved references protect this event’s slug and prevent deactivation. Reload to review current restrictions.",
  EVENT_SCHEDULE_LOCKED:
    "Check-in has started. The event schedule cannot be changed.",
  EVENT_UNIQUE_CONFLICT:
    "Slug or display order is already used. Choose a different value.",
  VALIDATION_ERROR:
    "Check the fields: end must follow start, and Maps must be a supported HTTPS Google Maps link.",
  CSRF_INVALID: "Session security refreshed. Review the form and save again.",
  FORBIDDEN: "Only an OWNER can manage events.",
};
export function EventManagement({
  csrfToken,
  initialSelection,
}: {
  csrfToken: string;
  initialSelection: string | null;
}) {
  const router = useRouter();
  const [csrf, setCsrf] = useState(csrfToken);
  const [items, setItems] = useState<api.ManagedEvent[]>([]);
  const [overviews, setOverviews] = useState<Map<string, api.EventOverview>>(
    new Map(),
  );
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [saved, setSaved] = useState<api.ManagedEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewRundown, setReviewRundown] = useState(false);
  const [draft, setDraft] = useState<api.EventFields>(empty);
  const [busy, setBusy] = useState(true);
  const [blocked, setBlocked] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("Loading saved events…");
  const [tone, setTone] = useState<"info" | "success" | "error" | "warning">(
    "info",
  );
  const submission = useRef(false);
  const stopped = useRef(false);
  const recoverySlug = useRef<string | null>(null);
  const requested = useRef(initialSelection);
  const form = useRef<HTMLFormElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<
    Partial<Record<ScheduleField, WibMinuteEdit>>
  >({});
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const used = saved ? Object.values(saved.usage).some((n) => n > 0) : false;
  const scheduleLocked = !!saved && saved.usage.checkins > 0;
  function nativeTime(key: ScheduleField) {
    return readWibMinuteAtSave(
      form.current?.querySelector<HTMLInputElement>(`#managed-${key}`),
      draft[key],
      schedule[key],
    );
  }
  function hasDraft() {
    return (
      dirty ||
      Boolean(
        (saved || creating) &&
        !scheduleLocked &&
        (nativeTime("startsAt") !== schedule.startsAt ||
          nativeTime("endsAt") !== schedule.endsAt),
      )
    );
  }
  useEditorNavigation(
    () => ({
      pending:
        !stopped.current && (submission.current || (catalogLoaded && busy)),
      blocked: !stopped.current && catalogLoaded && blocked,
      dirty: !stopped.current && hasDraft(),
    }),
    () => {
      setTone("warning");
      setMessage(
        "Finish the current action or reload saved events before leaving.",
      );
    },
  );
  function installCatalog(rows: api.ManagedEventOverview[]) {
    setCatalogLoaded(true);
    setItems(rows);
    setOverviews(new Map(rows.map((row) => [row.id, row.overview])));
  }
  function loadRow(row: api.ManagedEvent | null, rows = items) {
    setReviewRundown(false);
    setFieldErrors({});
    setSchedule({});
    setScheduleRevision((revision) => revision + 1);
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
    setTone(result.kind === "uncertain" ? "warning" : "error");
    if (result.kind === "uncertain") {
      setBlocked(true);
      setMessage(
        "Save outcome is unknown. Do not retry. Reload saved events to check whether it was saved; your draft is still shown.",
      );
    } else {
      if (result.csrfToken) setCsrf(result.csrfToken);
      if (result.code === "UNAUTHENTICATED") {
        stopped.current = true;
        setItems([]);
        setOverviews(new Map());
        setSaved(null);
        setDraft(empty());
        setCreating(false);
        router.replace(SESSION_ENDED_PATH);
      }
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
    const signout = () => {
      stopped.current = true;
      setItems([]);
      setOverviews(new Map());
      setSaved(null);
      setDraft(empty());
      setCreating(false);
      setBlocked(true);
    };
    window.addEventListener("admin:session-ended", signout);
    void api.list().then((result) => {
      if (!active || stopped.current) return;
      if (result.kind === "ok") {
        installCatalog(result.data.items);
        setBlocked(false);
        const row = result.data.items.find(
          (item) => item.id === initialSelection,
        );
        loadRow(row ?? null, result.data.items);
        setMessage(
          initialSelection && !row
            ? "Requested event is invalid or no longer available. Choose an event from the catalog."
            : "Saved events loaded.",
        );
      } else fail(result);
      setBusy(false);
    });
    return () => {
      active = false;
      window.removeEventListener("admin:session-ended", signout);
    };
    // Initial session-bound load only; later reloads are explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function reload() {
    if (submission.current || busy || stopped.current) return;
    if (
      hasDraft() &&
      !window.confirm("Reload saved events and discard the draft shown here?")
    )
      return;
    submission.current = true;
    setBusy(true);
    setBlocked(true);
    setTone("info");
    setMessage("Loading saved events…");
    const result = await api.list();
    submission.current = false;
    if (stopped.current) return;
    if (result.kind === "ok") {
      const rows = result.data.items;
      const slug = recoverySlug.current;
      const row = rows.find((r) =>
        slug ? r.slug === slug : r.id === requested.current,
      );
      recoverySlug.current = null;
      installCatalog(rows);
      loadRow(row ?? null, rows);
      setCreating(creating && !slug && !row);
      if (slug) {
        requested.current = row?.id ?? null;
        replaceEventSelection("/events", row?.id);
      }
      setBlocked(false);
      setTone("info");
      if (slug)
        setMessage(
          row
            ? "An event with that slug exists. Review its saved details before taking another action."
            : "No saved event has that slug in this read. Review the catalog before starting a new create.",
        );
      else
        setMessage(
          requested.current && !row
            ? "Requested event is invalid or no longer available. Choose an event from the catalog."
            : "Saved events loaded.",
        );
    } else {
      setOverviews(new Map());
      fail(result);
    }
    setBusy(false);
  }
  function select(row: api.ManagedEvent | null, focusEditor = false) {
    if (submission.current || busy || blocked || stopped.current) return;
    if (row && row.id === saved?.id) {
      if (focusEditor) editorHeading.current?.focus();
      return;
    }
    if (
      hasDraft() &&
      !window.confirm("Discard the current draft and switch events?")
    )
      return;
    setCreating(!row);
    requested.current = row?.id ?? null;
    replaceEventSelection("/events", row?.id);
    loadRow(row);
    setTone("info");
    setMessage(row ? "Saved state loaded." : "New event draft.");
    if (focusEditor)
      requestAnimationFrame(() => editorHeading.current?.focus());
  }
  function change<K extends keyof api.EventFields>(
    key: K,
    value: api.EventFields[K],
  ) {
    if (submission.current || busy || blocked) return;
    setDraft((d) => ({ ...d, [key]: value }));
    markChanged(key);
  }
  function changeTime(key: ScheduleField, edit: WibMinuteEdit) {
    if (submission.current || busy || blocked) return;
    setSchedule((current) => ({ ...current, [key]: edit }));
    markChanged("startsAt", "endsAt");
  }
  function markChanged(...keys: (keyof api.EventFields)[]) {
    setDirty(true);
    setTone("info");
    setMessage("Unsaved event changes.");
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }
  return (
    <section
      className="event-content-workspace event-management-workspace"
      aria-label="Event management editor"
    >
      <p>
        Configure wedding sessions and check which materials are ready for
        guests. Times use WIB (Asia/Jakarta).
      </p>
      <div className="event-workspace-actions">
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() => select(null, true)}
        >
          New event
        </button>
        <button type="button" disabled={busy} onClick={() => void reload()}>
          Reload saved events
        </button>
      </div>
      <section aria-labelledby="event-catalog-title">
        <h2 id="event-catalog-title">Event catalog</h2>
        {catalogLoaded && !items.length ? (
          <p>No saved events. Use New event to configure a session.</p>
        ) : null}
        {items.length ? (
          <p>
            Planning counts exclude walk-in registrations. Invited households
            can appear in more than one session.
          </p>
        ) : null}
        <ul className="event-catalog">
          {items.map((event) => (
            <li className="panel event-catalog-card" key={event.id}>
              <h3>{event.name}</h3>
              <p>
                {event.isActive ? "Active" : "Inactive"}
                {event.id === saved?.id ? " · Selected" : ""}
              </p>
              <EventFacts event={event} overview={overviews.get(event.id)} />
              {event.usage.checkins ? (
                <p>Slug, deactivation and schedule protected.</p>
              ) : Object.values(event.usage).some((count) => count > 0) ? (
                <p>Slug and deactivation protected.</p>
              ) : null}
              <button
                type="button"
                disabled={busy || blocked}
                onClick={() => select(event, true)}
              >
                <span aria-hidden="true">Configure session</span>
                <span className="sr-only">Configure {event.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <label htmlFor="managed-event-picker">Event to edit</label>
      <select
        id="managed-event-picker"
        disabled={busy || blocked}
        value={saved?.id ?? ""}
        onChange={(e) => {
          if (e.target.value)
            select(items.find((r) => r.id === e.target.value) ?? null);
        }}
      >
        <option value="" disabled>
          {creating ? "New event" : "Choose event"}
        </option>
        {items.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.isActive ? "" : " (inactive)"}
          </option>
        ))}
      </select>
      {saved ? (
        <section className="panel event-summary">
          <h2>{saved.name}</h2>
          <p>{saved.isActive ? "Active event" : "Inactive event"}</p>
          <p>
            Version {saved.version} · {saved.usage.invitations} historical and
            current invitation links · {saved.usage.rsvps} RSVP selection
            references · {saved.usage.checkins} check-in records
          </p>
          <EventReadiness event={saved} overview={overviews.get(saved.id)} />
          {reviewRundown ? (
            <p>
              Schedule saved. Review any related rundown in Event materials.
            </p>
          ) : null}
          <nav
            aria-label="Selected event workflows"
            className="event-workspace-actions"
          >
            {busy || blocked ? (
              <span>
                Reload or finish the current action to open related workflows.
              </span>
            ) : (
              <>
                <a
                  href={`/invitations?status=ACTIVE&eligibility=includes&eventId=${saved.id}`}
                >
                  View active eligible households, including walk-ins
                </a>
                <a href={`/rsvps?eventId=${saved.id}`}>
                  View RSVP responses referencing this event
                </a>
                <a href={eventHref("/event-content", saved.id)}>
                  Manage event materials
                </a>
              </>
            )}
          </nav>
        </section>
      ) : null}
      <form
        ref={form}
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            busy ||
            blocked ||
            submission.current ||
            stopped.current ||
            (!saved && !creating)
          )
            return;
          const startEdit = scheduleLocked ? undefined : nativeTime("startsAt");
          const endEdit = scheduleLocked ? undefined : nativeTime("endsAt");
          const errors: Record<string, string> = {};
          const startsAt = wibMinuteTimestamp(draft.startsAt, startEdit, null);
          const endsAt = wibMinuteTimestamp(draft.endsAt, endEdit, null);
          if (startEdit?.kind === "invalid") errors.startsAt = wibMinuteError;
          if (endEdit?.kind === "invalid") errors.endsAt = wibMinuteError;
          if (!errors.startsAt && !errors.endsAt && endsAt) {
            if (!startsAt)
              errors.startsAt = "Set a start time or clear the end time.";
            else if (Date.parse(endsAt) <= Date.parse(startsAt))
              errors.endsAt = "End must be later than start in WIB.";
          }
          if (draft.googleMapsUrl) {
            try {
              const url = new URL(draft.googleMapsUrl);
              if (
                url.protocol !== "https:" ||
                url.username ||
                url.password ||
                url.port ||
                !(
                  (["google.com", "www.google.com"].includes(url.hostname) &&
                    /^\/maps(?:\/|$)/.test(url.pathname)) ||
                  (url.hostname === "maps.app.goo.gl" &&
                    url.pathname.length > 1)
                )
              )
                errors.googleMapsUrl =
                  "Enter a supported HTTPS Google Maps link.";
            } catch {
              errors.googleMapsUrl = "Enter a valid Google Maps link.";
            }
          }
          setFieldErrors(errors);
          if (Object.keys(errors).length) {
            setTone("error");
            setMessage("Review the highlighted Event fields.");
            const form = e.currentTarget;
            requestAnimationFrame(() =>
              (
                form.querySelector<HTMLElement>(
                  '[aria-invalid="true"]:not(:disabled)',
                ) ?? feedback.current
              )?.focus(),
            );
            return;
          }
          submission.current = true;
          setBusy(true);
          setTone("info");
          setMessage("Saving event…");
          const result = await api.save(
            { ...draft, startsAt, endsAt },
            csrf,
            saved,
          );
          if (stopped.current) return;
          if (
            result.kind === "ok" &&
            (saved
              ? result.data.id === saved.id &&
                result.data.version === saved.version + 1
              : result.data.slug === draft.slug && result.data.version === 1)
          ) {
            const rows = [
              ...items.filter((r) => r.id !== result.data.id),
              result.data,
            ].sort((a, b) => a.displayOrder - b.displayOrder);
            setItems(rows);
            loadRow(result.data, rows);
            setCreating(false);
            requested.current = result.data.id;
            replaceEventSelection("/events", result.data.id);
            setOverviews(new Map());
            const overview = await api.list();
            if (stopped.current) return;
            if (overview.kind === "ok") {
              installCatalog(overview.data.items);
              const latest = overview.data.items.find(
                (row) => row.id === result.data.id,
              );
              if (latest) loadRow(latest, overview.data.items);
            } else if (
              overview.kind === "error" &&
              overview.code === "UNAUTHENTICATED"
            ) {
              fail(overview);
              return;
            }
            const scheduleChanged =
              saved &&
              (saved.startsAt !== result.data.startsAt ||
                saved.endsAt !== result.data.endsAt);
            setTone("success");
            setMessage("Event saved successfully.");
            setReviewRundown(Boolean(scheduleChanged));
          } else {
            const failure =
              result.kind === "ok" ? { kind: "uncertain" as const } : result;
            if (!saved && failure.kind === "uncertain")
              recoverySlug.current = draft.slug;
            fail(failure);
          }
          setBusy(false);
          submission.current = false;
          requestAnimationFrame(() => {
            feedback.current?.focus();
            feedback.current?.scrollIntoView({ block: "nearest" });
          });
        }}
      >
        {saved || creating ? (
          <>
            <h2 ref={editorHeading} tabIndex={-1}>
              {saved ? "Edit event" : "Create event"}
            </h2>
            <fieldset disabled={busy || blocked} aria-label="Event settings">
              <fieldset>
                <legend>Event identity</legend>
                {used ? (
                  <p>
                    Invitation, RSVP or check-in references protect the saved
                    slug.
                  </p>
                ) : null}
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
                    onChange={(e) =>
                      change("description", e.target.value || null)
                    }
                  />
                </label>
              </fieldset>
              <fieldset>
                <legend>Schedule · WIB (Asia/Jakarta)</legend>
                {scheduleLocked ? (
                  <p>
                    Existing check-in records protect the saved start and end
                    times.
                  </p>
                ) : null}
                <WibDateTimeField
                  id="managed-startsAt"
                  key={`start-${scheduleRevision}`}
                  label="Start (WIB)"
                  clearLabel="Clear start time"
                  disabled={scheduleLocked}
                  original={draft.startsAt}
                  edit={schedule.startsAt}
                  onEdit={(edit) => changeTime("startsAt", edit)}
                  error={fieldErrors.startsAt}
                />
                <WibDateTimeField
                  id="managed-endsAt"
                  key={`end-${scheduleRevision}`}
                  label="End (WIB)"
                  clearLabel="Clear end time"
                  disabled={scheduleLocked}
                  original={draft.endsAt}
                  edit={schedule.endsAt}
                  onEdit={(edit) => changeTime("endsAt", edit)}
                  error={fieldErrors.endsAt}
                />
              </fieldset>
              <fieldset>
                <legend>Venue and location</legend>
                <label>
                  Venue name
                  <input
                    maxLength={300}
                    value={draft.venueName ?? ""}
                    onChange={(e) =>
                      change("venueName", e.target.value || null)
                    }
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
                    aria-invalid={!!fieldErrors.googleMapsUrl}
                    aria-describedby={
                      fieldErrors.googleMapsUrl ? "event-maps-error" : undefined
                    }
                    onChange={(e) =>
                      change("googleMapsUrl", e.target.value || null)
                    }
                  />
                </label>
                {fieldErrors.googleMapsUrl ? (
                  <p id="event-maps-error" className="field-error">
                    {fieldErrors.googleMapsUrl}
                  </p>
                ) : null}
              </fieldset>
              <fieldset>
                <legend>Display and activation</legend>
                <p>
                  Use a unique display order. Saved changes appear on the next
                  guest page load. Events cannot be deleted here.
                </p>
                {used && saved?.isActive ? (
                  <p>Existing references prevent deactivating this event.</p>
                ) : null}
                <label>
                  Display order
                  <input
                    type="number"
                    required
                    min={0}
                    max={2147483647}
                    step={1}
                    value={draft.displayOrder}
                    onChange={(e) =>
                      change("displayOrder", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    disabled={used && saved?.isActive}
                    checked={draft.isActive}
                    onChange={(e) => change("isActive", e.target.checked)}
                  />
                  Active event
                </label>
              </fieldset>
              <button type="submit" disabled={!dirty}>
                {busy ? "Saving…" : "Save event"}
              </button>
            </fieldset>
          </>
        ) : null}
        <div ref={feedback} tabIndex={-1} className="action-feedback-anchor">
          <ActionFeedback tone={tone}>{message}</ActionFeedback>
        </div>
      </form>
    </section>
  );
}
