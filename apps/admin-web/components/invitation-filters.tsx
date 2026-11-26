"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHydrated } from "../src/invitations/use-hydrated";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  parseInvitationQuery,
  listHref,
  type InvitationQuery,
} from "../src/invitations/query";
type EventOption = { id: string; name: string; isActive: boolean };
export function InvitationFilters({
  query,
  events,
}: {
  query: InvitationQuery;
  events: EventOption[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const hydrated = useHydrated();
  // Next can restore a previously visited screen. Restore URL defaults when
  // its effect is reactivated, rather than keeping unsent filter edits.
  useEffect(() => {
    formRef.current?.reset();
  }, [query]);
  const [error, setError] = useState("");
  const [eligibility, setEligibility] = useState(query.eligibility ?? "");
  const needsEvents = eligibility === "exact" || eligibility === "includes";
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
    startTransition(() =>
      router.push(listHref(next, 1) + "#invitation-results-heading"),
    );
  }
  return (
    <form
      ref={formRef}
      className="invitation-filters"
      onSubmit={submit}
      aria-label="Search and filter invitations"
    >
      <div className="filter-search">
        <label htmlFor="search">Search invitations</label>
        <input
          id="search"
          name="search"
          defaultValue={query.search ?? ""}
          aria-describedby="search-help search-error"
        />
        <p id="search-help" className="hint">
          Display name, greeting name or invitee name. Up to 100 characters.
        </p>
      </div>
      <div>
        <label htmlFor="status">Invitation status</label>
        <select id="status" name="status" defaultValue={query.status ?? ""}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>
      <div>
        <label htmlFor="rsvpStatus">RSVP status</label>
        <select
          id="rsvpStatus"
          name="rsvpStatus"
          defaultValue={query.rsvpStatus ?? ""}
        >
          <option value="">All RSVPs</option>
          <option value="PENDING">Pending</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="DECLINED">Declined</option>
        </select>
      </div>
      <div>
        <label htmlFor="opening">Opening activity</label>
        <select id="opening" name="opening" defaultValue={query.opening ?? ""}>
          <option value="">All opening activity</option>
          <option value="opened">Opened</option>
          <option value="unopened">Not yet opened</option>
        </select>
      </div>
      <fieldset className="invitation-eligibility-filters">
        <legend>Eligible sessions</legend>
        <div>
          <label htmlFor="eligibility">Match</label>
          <select
            id="eligibility"
            name="eligibility"
            value={eligibility}
            onChange={(event) => setEligibility(event.currentTarget.value)}
          >
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
              <select
                id="eventId"
                name="eventId"
                required
                defaultValue={query.eventId ?? ""}
              >
                <option value="">Choose a session</option>
                {eventOptions(query.eventId)}
              </select>
            </div>
            <div>
              <label htmlFor="secondEventId">Second session (optional)</label>
              <select
                id="secondEventId"
                name="secondEventId"
                defaultValue={query.secondEventId ?? ""}
              >
                <option value="">One session only</option>
                {eventOptions(query.secondEventId)}
              </select>
            </div>
          </>
        )}
      </fieldset>
      <div>
        <label htmlFor="sortBy">Sort by</label>
        <select id="sortBy" name="sortBy" defaultValue={query.sortBy}>
          <option value="createdAt">Created date</option>
          <option value="updatedAt">Updated date</option>
          <option value="displayName">Display name</option>
          <option value="status">Invitation status</option>
          <option value="lastOpenedAt">Last opened</option>
        </select>
      </div>
      <div>
        <label htmlFor="sortOrder">Sort direction</label>
        <select id="sortOrder" name="sortOrder" defaultValue={query.sortOrder}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>
      <div>
        <label htmlFor="pageSize">Per page</label>
        <input
          id="pageSize"
          name="pageSize"
          type="number"
          min={1}
          max={100}
          step={1}
          required
          defaultValue={query.pageSize}
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
        <button disabled={!hydrated || pending}>
          {pending ? "Loading…" : "Apply search and filters"}
        </button>
        <Link href="/invitations" prefetch={false}>
          Reset all
        </Link>
      </div>
    </form>
  );
}
