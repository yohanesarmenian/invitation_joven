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
import {
  messageListHref,
  parseMessageQuery,
  type MessageQuery,
} from "../src/messages/query";

export function MessageFilters({ query }: { query: MessageQuery }) {
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
    const next = parseMessageQuery(
      Object.fromEntries(
        [...form.entries()].map(([key, value]) => [key, String(value)]),
      ),
    );
    if (!next) {
      setError(
        "Use valid message filters, a valid invitation id, and a page size from 1 to 100.",
      );
      return;
    }
    setError("");
    startTransition(() => router.push(messageListHref(next, 1)));
  }

  return (
    <form
      ref={formRef}
      className="invitation-filters message-filters"
      onSubmit={submit}
      aria-label="Filter guest messages"
    >
      <input
        type="hidden"
        name="invitationId"
        value={query.invitationId ?? ""}
      />
      <div>
        <label htmlFor="hidden">Visibility</label>
        <select id="hidden" name="hidden" defaultValue={query.hidden}>
          <option value="all">All messages</option>
          <option value="visible">Visible only</option>
          <option value="hidden">Hidden only</option>
        </select>
      </div>
      <div>
        <label htmlFor="sortOrder">Sort direction</label>
        <select id="sortOrder" name="sortOrder" defaultValue={query.sortOrder}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
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
      <input type="hidden" name="sortBy" value="createdAt" />
      <p
        id="message-filter-error"
        className="field-error"
        role={error ? "alert" : undefined}
      >
        {error}
      </p>
      <div className="invitation-actions">
        <button disabled={pending}>
          {pending ? "Loading..." : "Apply filters"}
        </button>
        <Link
          href={query.invitationId ? `/messages?invitationId=${query.invitationId}` : "/messages"}
          prefetch={false}
        >
          Reset filters
        </Link>
      </div>
    </form>
  );
}
