import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../../src/auth/auth-state";
import {
  parseRsvpQuery,
  rsvpQueryString,
  type SearchParams,
} from "../../../src/rsvps/query";
import { getRsvpEvents } from "../../../src/rsvps/server-rsvps";
import { RsvpFilters } from "../../../components/rsvp-filters";
import { RsvpReadError, RsvpResults } from "../../../components/rsvp-list";

export default async function RsvpsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if ((await getServerSession()).kind !== "authenticated") return null;
  const params = await searchParams;
  const query = parseRsvpQuery(params);
  if (
    query &&
    typeof params.search === "string" &&
    params.search !== (query.search ?? "")
  )
    redirect(`/rsvps?${rsvpQueryString(query)}`);
  return (
    <>
      <header className="dashboard-heading invitation-heading">
        <div>
          <p className="eyebrow">Guest management</p>
          <h1>RSVPs</h1>
          <p>Review persisted household responses and event attendance intent.</p>
        </div>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </header>
      {!query ? (
        <section className="dashboard-error" role="alert">
          <h2>Invalid search or filters</h2>
          <p>This address contains unsupported query values.</p>
          <Link href="/rsvps" prefetch={false}>
            Reset search and filters
          </Link>
        </section>
      ) : (
        <RsvpPageContent query={query} />
      )}
    </>
  );
}

async function RsvpPageContent({
  query,
}: {
  query: NonNullable<ReturnType<typeof parseRsvpQuery>>;
}) {
  const events = await getRsvpEvents();
  if (events.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (events.kind !== "ready")
    return (
      <RsvpReadError
        forbidden={events.kind === "forbidden"}
        href={`/rsvps?${rsvpQueryString(query)}`}
      />
    );
  return (
    <>
      <RsvpFilters
        key={"filters-" + rsvpQueryString(query)}
        events={events.data.events}
        query={query}
      />
      <Suspense
        key={"results-" + rsvpQueryString(query)}
        fallback={<p role="status">Loading RSVPs...</p>}
      >
        <RsvpResults query={query} />
      </Suspense>
    </>
  );
}
