"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
import {
  parseRsvpQuery,
  rsvpListHref,
  type RsvpQuery,
} from "../src/rsvps/query";

export function RsvpFilters({
  events,
  query,
}: {
  events: AdminEventsResponse["events"];
  query: RsvpQuery;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.reset();
  }, [query]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = parseRsvpQuery(
      Object.fromEntries(
        [...form.entries()].map(([key, value]) => [key, String(value)]),
      ),
    );
    if (!next) {
      setError(
        "Use valid RSVP filters, a search of 100 characters or fewer, and a page size from 1 to 100.",
      );
      return;
    }
    setError("");
    startTransition(() => router.push(rsvpListHref(next, 1)));
  }

  return (
    <form
      ref={formRef}
      className="invitation-filters"
      onSubmit={submit}
      aria-label="Search and filter RSVPs"
    >
      <div className="filter-search">
        <label htmlFor="search">Search RSVPs</label>
        <input
          id="search"
          name="search"
          defaultValue={query.search ?? ""}
          aria-describedby="search-help search-error"
          aria-invalid={Boolean(error)}
        />
        <p id="search-help" className="hint">
          Invitation display name, greeting name or invitee name. Up to 100
          characters.
        </p>
      </div>
      <div>
        <label htmlFor="status">RSVP status</label>
        <select id="status" name="status" defaultValue={query.status ?? ""}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="DECLINED">Declined</option>
        </select>
      </div>
      <div>
        <label htmlFor="eventId">Event</label>
        <select id="eventId" name="eventId" defaultValue={query.eventId ?? ""}>
          <option value="">All events</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
              {event.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sortBy">Sort by</label>
        <select id="sortBy" name="sortBy" defaultValue={query.sortBy}>
          <option value="updatedAt">Updated date</option>
          <option value="createdAt">Created date</option>
          <option value="status">RSVP status</option>
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
        className="field-error"
        role={error ? "alert" : undefined}
      >
        {error}
      </p>
      <div className="invitation-actions">
        <button disabled={pending}>
          {pending ? "Loading..." : "Apply search and filters"}
        </button>
        <Link href="/rsvps" prefetch={false}>
          Reset all
        </Link>
      </div>
    </form>
  );
}
