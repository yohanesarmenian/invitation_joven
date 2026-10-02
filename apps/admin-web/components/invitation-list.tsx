import Link from "next/link";
import { redirect } from "next/navigation";
import type { AdminInvitationListResponse } from "@wedding-invitation/api-client/src/index";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { getInvitations } from "../src/invitations/server-invitations";
import { listHref, type InvitationQuery } from "../src/invitations/query";

export function InvitationReadError({
  forbidden,
  href,
}: {
  forbidden?: boolean;
  href: string;
}) {
  return (
    <section className="dashboard-error" role="alert">
      <h2>
        {forbidden
          ? "Invitation access unavailable"
          : "Unable to load invitations"}
      </h2>
      <p>
        {forbidden
          ? "Your account cannot access this information."
          : "Please try again. No changes have been made."}
      </p>
      {/* A full document request rechecks the session and avoids stale router data. */}
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
function DateValue({ value, empty }: { value: string | null; empty: string }) {
  return value ? (
    <time dateTime={value}>{dateFormat.format(new Date(value))}</time>
  ) : (
    <span>{empty}</span>
  );
}
export function InvitationList({
  data,
  query,
}: {
  data: AdminInvitationListResponse;
  query: InvitationQuery;
}) {
  const { items, page } = data;
  const filtered = Boolean(query.search || query.status || query.rsvpStatus);
  return (
    <section aria-label="Invitation results" className="invitation-results">
      <div className="results-heading">
        <h2>Invitations</h2>
        <p>
          {page.totalItems}{" "}
          {page.totalItems === 1 ? "invitation" : "invitations"}
          {filtered ? " matching your search and filters" : " in total"}
        </p>
      </div>
      {!items.length ? (
        <div className="invitation-empty">
          <h3>
            {page.totalItems > 0
              ? "No invitations on this page"
              : filtered
                ? "No matching invitations"
                : "No invitations yet"}
          </h3>
          <p>
            {page.totalItems > 0
              ? "This page is beyond the current results. Return to the first page to see invitations."
              : filtered
                ? "Try another search or clear the filters."
                : "Create your first invitation to start managing your guest list."}
          </p>
          <Link
            href={
              page.totalItems > 0
                ? listHref(query, 1)
                : filtered
                  ? "/invitations"
                  : "/invitations/new"
            }
            prefetch={false}
          >
            {page.totalItems > 0
              ? "First page"
              : filtered
                ? "Clear search and filters"
                : "Create an invitation"}
          </Link>
        </div>
      ) : (
        <>
          <p className="hint" id="table-help">
            Dates are shown in Asia/Jakarta (UTC+07:00). On smaller screens,
            scroll the table horizontally.
          </p>
          <div
            className="invitation-table-scroll"
            role="region"
            aria-label="Invitations table"
            aria-describedby="table-help"
            tabIndex={0}
          >
            <table className="invitation-table">
              <caption className="sr-only">
                Invitations with status, RSVP and opening activity
              </caption>
              <thead>
                <tr>
                  <th scope="col">Invitation</th>
                  <th scope="col">Status</th>
                  <th scope="col">RSVP</th>
                  <th scope="col">Invitees</th>
                  <th scope="col">Opens</th>
                  <th scope="col">Last opened</th>
                  <th scope="col">RSVP deadline</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      {item.displayName}
                      {item.greetingName && (
                        <span className="greeting-name">
                          {item.greetingName}
                        </span>
                      )}
                    </th>
                    <td>
                      <span className="status-label">
                        {item.status === "ACTIVE" ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td>
                      {item.rsvpStatus === "PENDING"
                        ? "Pending"
                        : item.rsvpStatus === "ACCEPTED"
                          ? "Accepted"
                          : "Declined"}
                    </td>
                    <td>{item.inviteeCount}</td>
                    <td>{item.openCount}</td>
                    <td>
                      <DateValue value={item.lastOpenedAt} empty="Not opened" />
                    </td>
                    <td>
                      <DateValue
                        value={item.rsvpDeadlineAt}
                        empty="No deadline"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <nav className="invitation-pagination" aria-label="Invitation pagination">
        <p>
          Page {page.number} · {page.totalPages}{" "}
          {page.totalPages === 1 ? "page" : "pages"} of results
        </p>
        <div>
          {page.number > 1 ? (
            <Link prefetch={false} href={listHref(query, page.number - 1)}>
              Previous
            </Link>
          ) : (
            <span aria-disabled="true">Previous</span>
          )}
          {page.number < page.totalPages ? (
            <Link prefetch={false} href={listHref(query, page.number + 1)}>
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
export async function InvitationResults({ query }: { query: InvitationQuery }) {
  const result = await getInvitations(query);
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (result.kind !== "ready")
    return (
      <InvitationReadError
        forbidden={result.kind === "forbidden"}
        href={listHref(query, query.page)}
      />
    );
  return <InvitationList data={result.data} query={query} />;
}
