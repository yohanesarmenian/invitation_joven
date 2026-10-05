import Link from "next/link";
import { redirect } from "next/navigation";
import type { AdminRsvpListResponse } from "@wedding-invitation/api-client/src/index";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { getRsvps } from "../src/rsvps/server-rsvps";
import { rsvpListHref, type RsvpQuery } from "../src/rsvps/query";

export function RsvpReadError({
  forbidden,
  href,
}: {
  forbidden?: boolean;
  href: string;
}) {
  return (
    <section className="dashboard-error" role="alert">
      <h2>{forbidden ? "RSVP access unavailable" : "Unable to load RSVPs"}</h2>
      <p>
        {forbidden
          ? "Your account cannot access this information."
          : "Please try again. No changes have been made."}
      </p>
      <a className="dashboard-retry" href={href}>
        Try again
      </a>
    </section>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function DateValue({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}

function statusLabel(status: "PENDING" | "ACCEPTED" | "DECLINED") {
  return status === "PENDING"
    ? "Pending"
    : status === "ACCEPTED"
      ? "Accepted"
      : "Declined";
}

export function RsvpList({
  data,
  query,
}: {
  data: AdminRsvpListResponse;
  query: RsvpQuery;
}) {
  const { items, page } = data;
  const filtered = Boolean(query.search || query.status || query.eventId);
  return (
    <section aria-label="RSVP results" className="invitation-results">
      <div className="results-heading">
        <h2>Persisted RSVPs</h2>
        <p>
          {page.totalItems} {page.totalItems === 1 ? "RSVP" : "RSVPs"}
          {filtered ? " matching your search and filters" : " in total"}
        </p>
      </div>
      {!items.length ? (
        <div className="invitation-empty">
          <h3>
            {page.totalItems > 0
              ? "No RSVPs on this page"
              : filtered
                ? "No matching RSVPs"
                : "No persisted RSVPs yet"}
          </h3>
          <p>
            {page.totalItems > 0
              ? "This page is beyond the current results. Return to the first page to see RSVPs."
              : filtered
                ? "Try another search or clear the filters."
                : "Invitations without an RSVP row stay in the invitation list and are not synthesized here."}
          </p>
          <Link
            href={page.totalItems > 0 || filtered ? rsvpListHref(query, 1) : "/"}
            prefetch={false}
          >
            {page.totalItems > 0 || filtered
              ? "First page"
              : "Back to dashboard"}
          </Link>
        </div>
      ) : (
        <>
          <p className="hint" id="rsvp-table-help">
            Dates are shown in Asia/Jakarta (UTC+07:00). On smaller screens,
            scroll the table horizontally.
          </p>
          <div
            className="invitation-table-scroll"
            role="region"
            aria-label="RSVPs table"
            aria-describedby="rsvp-table-help"
            tabIndex={0}
          >
            <table className="invitation-table">
              <caption className="sr-only">
                Persisted RSVPs with invitation context and attendee aggregates
              </caption>
              <thead>
                <tr>
                  <th scope="col">Invitation</th>
                  <th scope="col">RSVP</th>
                  <th scope="col">Attendees</th>
                  <th scope="col">Attending events</th>
                  <th scope="col">Submitted by</th>
                  <th scope="col">Created</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      <Link href={`/rsvps/${item.id}`} prefetch={false}>
                        {item.invitation.displayName}
                      </Link>
                      <span className="greeting-name">
                        {item.invitation.status === "ACTIVE"
                          ? "Active invitation"
                          : "Archived invitation"}
                      </span>
                    </th>
                    <td>
                      <span className="status-label">
                        {statusLabel(item.status)} v{item.version}
                      </span>
                    </td>
                    <td>{item.attendeeCount}</td>
                    <td>{item.attendingEventCount}</td>
                    <td>{item.submittedByAdmin ? "OWNER" : "Guest"}</td>
                    <td>
                      <DateValue value={item.createdAt} />
                    </td>
                    <td>
                      <DateValue value={item.updatedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <nav className="invitation-pagination" aria-label="RSVP pagination">
        <p>
          Page {page.number} - {page.totalPages}{" "}
          {page.totalPages === 1 ? "page" : "pages"} of results
        </p>
        <div>
          {page.number > 1 ? (
            <Link prefetch={false} href={rsvpListHref(query, page.number - 1)}>
              Previous
            </Link>
          ) : (
            <span aria-disabled="true">Previous</span>
          )}
          {page.number < page.totalPages ? (
            <Link prefetch={false} href={rsvpListHref(query, page.number + 1)}>
              Next
            </Link>
          ) : (
            <span aria-disabled="true">Next</span>
          )}
        </div>
      </nav>
    </section>
  );
}

export async function RsvpResults({ query }: { query: RsvpQuery }) {
  const result = await getRsvps(query);
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (result.kind !== "ready")
    return (
      <RsvpReadError
        forbidden={result.kind === "forbidden"}
        href={rsvpListHref(query, query.page)}
      />
    );
  return <RsvpList data={result.data} query={query} />;
}
