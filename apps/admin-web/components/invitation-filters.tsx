"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHydrated } from "../src/invitations/use-hydrated";
import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  parseInvitationQuery,
  listHref,
  queryString,
  type InvitationQuery,
} from "../src/invitations/query";
type EventOption = { id: string; name: string; isActive: boolean };
type FilterDraft = Record<Exclude<keyof InvitationQuery, "page">, string>;

const defaultQuery = parseInvitationQuery({})!;

function filterDraft(query: InvitationQuery): FilterDraft {
  return {
    search: query.search ?? "",
    status: query.status ?? "",
    rsvpStatus: query.rsvpStatus ?? "",
    opening: query.opening ?? "",
    eligibility: query.eligibility ?? "",
    eventId: query.eventId ?? "",
    secondEventId: query.secondEventId ?? "",
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    pageSize: String(query.pageSize),
  };
}

export function InvitationFilters({
  query,
  events,
}: {
  query: InvitationQuery;
  events: EventOption[];
}) {
  const router = useRouter();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const hydrated = useHydrated();
  const [error, setError] = useState("");
  // InvitationResults is keyed by its committed query, including pagination.
  const [draft, setDraft] = useState(() => filterDraft(query));
  const applied = filterDraft(query);
  const hasUnappliedChanges = (
    Object.keys(draft) as (keyof FilterDraft)[]
  ).some((name) => draft[name] !== applied[name]);
  const needsEvents =
    draft.eligibility === "exact" || draft.eligibility === "includes";
  function field(name: keyof FilterDraft) {
    return {
      id: name,
      name,
      value: draft[name],
      disabled: !hydrated,
      onChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
        const value = event.currentTarget.value;
        setDraft((current) => ({
          ...current,
          [name]: value,
          ...(name === "eligibility" &&
          value !== "exact" &&
          value !== "includes"
            ? { eventId: "", secondEventId: "" }
            : {}),
        }));
      },
    };
  }
  const eventOptions = (selected: string | undefined) => (
    <>
      {selected && !events.some(({ id }) => id === selected) && (
        <option value={selected}>Unavailable session</option>
      )}
      {events.map(({ id, name, isActive }) => (
        <option key={id} value={id}>
          {name}
          {isActive ? "" : " (Inactive)"}
        </option>
      ))}
    </>
  );
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = parseInvitationQuery(
      Object.fromEntries(
        [...form.entries()]
          .filter(
            ([key, value]) =>
              value !== "" ||
              !["eligibility", "eventId", "secondEventId", "opening"].includes(
                key,
              ),
          )
          .map(([key, value]) => [key, String(value)]),
      ),
    );
    if (!next) {
      setError(
        "Choose distinct sessions for the eligibility filter, use a search of up to 100 characters, and set a page size from 1 to 100.",
      );
      return;
    }
    setError("");
    if (queryString(next) === queryString(query)) setDraft(filterDraft(next));
    startTransition(() =>
      router.push(listHref(next, 1) + "#invitation-results-heading"),
    );
  }
  return (
    <form
      className="invitation-filters"
      onSubmit={submit}
      aria-label="Search and filter invitations"
    >
      <div className="filter-search">
        <label htmlFor="search">Search invitations</label>
        <input
          {...field("search")}
          aria-describedby="search-help search-error"
        />
        <p id="search-help" className="hint">
          Display name, greeting name or invitee name. Up to 100 characters.
        </p>
      </div>
      <div>
        <label htmlFor="status">Invitation status</label>
        <select {...field("status")}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>
      <div>
        <label htmlFor="rsvpStatus">RSVP status</label>
        <select {...field("rsvpStatus")}>
          <option value="">All RSVPs</option>
          <option value="PENDING">Pending</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="DECLINED">Declined</option>
        </select>
      </div>
      <div>
        <label htmlFor="opening">Opening activity</label>
        <select {...field("opening")}>
          <option value="">All opening activity</option>
          <option value="opened">Opened</option>
          <option value="unopened">Not yet opened</option>
        </select>
      </div>
      <fieldset className="invitation-eligibility-filters">
        <legend>Eligible sessions</legend>
        <div>
          <label htmlFor="eligibility">Match</label>
          <select {...field("eligibility")}>
            <option value="">All eligibility</option>
            <option value="includes">Includes selected sessions</option>
            <option value="exact">Exactly selected sessions</option>
            <option value="none">No eligible sessions</option>
            <option value="legacy">More than two sessions</option>
          </select>
        </div>
        {needsEvents && (
          <>
            <div>
              <label htmlFor="eventId">Session</label>
              <select {...field("eventId")} required>
                <option value="">Choose a session</option>
                {eventOptions(query.eventId)}
              </select>
            </div>
            <div>
              <label htmlFor="secondEventId">Second session (optional)</label>
              <select {...field("secondEventId")}>
                <option value="">One session only</option>
                {eventOptions(query.secondEventId)}
              </select>
            </div>
          </>
        )}
      </fieldset>
      <div>
        <label htmlFor="sortBy">Sort by</label>
        <select {...field("sortBy")}>
          <option value="createdAt">Created date</option>
          <option value="updatedAt">Updated date</option>
          <option value="displayName">Display name</option>
          <option value="status">Invitation status</option>
          <option value="lastOpenedAt">Last opened</option>
        </select>
      </div>
      <div>
        <label htmlFor="sortOrder">Sort direction</label>
        <select {...field("sortOrder")}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>
      <div>
        <label htmlFor="pageSize">Per page</label>
        <input
          {...field("pageSize")}
          type="number"
          min={1}
          max={100}
          step={1}
          required
        />
      </div>
      <p
        id="search-error"
        ref={errorRef}
        tabIndex={-1}
        className="field-error"
        role={error ? "alert" : undefined}
      >
        {error}
      </p>
      <div className="invitation-actions">
        {hasUnappliedChanges && !pending && (
          <p className="hint">Apply changes to update the results.</p>
        )}
        <button disabled={!hydrated || pending}>
          {pending ? "Loading…" : "Apply search and filters"}
        </button>
        <Link
          href="/invitations"
          prefetch={false}
          onNavigate={() => {
            // A reset on the default query may keep this form mounted.
            if (queryString(query) === queryString(defaultQuery)) {
              setDraft(filterDraft(defaultQuery));
              setError("");
            }
          }}
        >
          Reset all
        </Link>
      </div>
    </form>
  );
}
