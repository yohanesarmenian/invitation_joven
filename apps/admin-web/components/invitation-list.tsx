import Link from "next/link";
import { redirect } from "next/navigation";
import type { AdminInvitationListResponse } from "@wedding-invitation/api-client/src/index";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { getInvitations } from "../src/invitations/server-invitations";
import { listHref, type InvitationQuery } from "../src/invitations/query";
import { MAX_ELIGIBLE_SESSIONS } from "../src/invitations/session-selection";
import { InvitationRowSharing } from "./invitation-row-sharing";
import { InvitationFilters } from "./invitation-filters";
import { InvitationSessionLabels } from "./invitation-session-labels";
import { InvitationResultsHeading } from "./invitation-results-heading";

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
function InvitationOverview({
  overview,
}: {
  overview: AdminInvitationListResponse["overview"];
}) {
  return (
    <section
      className="invitation-overview"
      aria-labelledby="invitation-overview-heading"
    >
      <h2 id="invitation-overview-heading">Active invitation overview</h2>
      <p className="hint">All active households, across filters and pages.</p>
      <dl className="invitation-overview-metrics">
        <div>
          <dt>Households</dt>
          <dd>{overview.households}</dd>
        </div>
        <div>
          <dt>Named guests</dt>
          <dd>{overview.namedGuests}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{overview.opened}</dd>
        </div>
        <div>
          <dt>Unopened</dt>
          <dd>{overview.unopened}</dd>
        </div>
        <div>
          <dt>Accepted</dt>
          <dd>{overview.rsvp.accepted}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{overview.rsvp.pending}</dd>
        </div>
        <div>
          <dt>Declined</dt>
          <dd>{overview.rsvp.declined}</dd>
        </div>
      </dl>
      <h3>Eligible households by session</h3>
      <p className="hint">
        A household can count in several sessions. Eligibility is permission to
        attend. Opening activity measures recorded link opens; delivery status
        is unavailable.
      </p>
      {overview.events.length > 0 ? (
        <ul className="invitation-overview-sessions">
          {overview.events.map((event) => (
            <li key={event.id}>
              <span>
                {event.name}
                {!event.isActive && " · Inactive"}
              </span>
              <strong>{event.eligibleHouseholds}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>No wedding sessions in the catalog.</p>
      )}
    </section>
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
  const filtered = Boolean(
    query.search ||
    query.status ||
    query.rsvpStatus ||
    query.eligibility ||
    query.opening,
  );
  return (
    <section aria-label="Invitation results" className="invitation-results">
      <div className="results-heading">
        <InvitationResultsHeading />
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
            Dates are shown in Asia/Jakarta (UTC+07:00). Select an invitation to
            manage its guest details, sharing and settings.
          </p>
          <div
            className="invitation-table-scroll"
            role="region"
            aria-label="Invitations table"
            aria-describedby="table-help"
            tabIndex={0}
          >
            <table
              className="invitation-table invitation-table--responsive"
              role="table"
            >
              <caption className="sr-only">
                Invitations with status, RSVP and opening activity
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    Invitation
                  </th>
                  <th scope="col" role="columnheader">
                    Status
                  </th>
                  <th scope="col" role="columnheader">
                    Eligible sessions
                  </th>
                  <th scope="col" role="columnheader">
                    RSVP
                  </th>
                  <th scope="col" role="columnheader">
                    Named guests
                  </th>
                  <th scope="col" role="columnheader">
                    Opening activity
                  </th>
                  <th scope="col" role="columnheader">
                    Sharing
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {items.map((item) => (
                  <tr key={item.id} className="invitation-row" role="row">
                    <th
                      scope="row"
                      role="rowheader"
                      className="invitation-identity"
                    >
                      <Link
                        className="invitation-identity-link"
                        href={`/invitations/${item.id}`}
                        prefetch={false}
                      >
                        <span className="invitation-name">
                          {item.displayName}
                        </span>
                        {/* One link keeps the existing guest-name selector and tab stop. */}
                        <span className="invitation-manage" aria-hidden="true">
                          Manage invitation <span>↗</span>
                        </span>
                      </Link>
                      {item.greetingName && (
                        <span className="greeting-name">
                          {item.greetingName}
                        </span>
                      )}
                    </th>
                    <td
                      role="cell"
                      className="invitation-status-cell"
                      data-label="Status"
                    >
                      <span className="status-label" data-status={item.status}>
                        {item.status === "ACTIVE" ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td
                      role="cell"
                      className="invitation-eligibility-cell"
                      data-label="Eligible sessions"
                    >
                      <InvitationSessionLabels
                        sessions={item.eligibleEvents}
                        empty="No eligible sessions"
                      />
                      {(!item.eligibleEvents.length ||
                        item.eligibleEvents.length > MAX_ELIGIBLE_SESSIONS) && (
                        <div className="invitation-eligibility-warning">
                          {item.eligibleEvents.length >
                            MAX_ELIGIBLE_SESSIONS && (
                            <span>
                              Legacy eligibility exceeds two sessions.
                            </span>
                          )}
                          <Link
                            href={`/invitations/${item.id}#eligible-events-title`}
                            prefetch={false}
                          >
                            {item.status === "ACTIVE"
                              ? "Review eligibility"
                              : "View eligibility"}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td
                      role="cell"
                      className="invitation-rsvp-cell"
                      data-label="RSVP"
                    >
                      <span
                        className="invitation-rsvp"
                        data-rsvp-status={item.rsvpStatus}
                      >
                        {item.rsvpStatus === "PENDING"
                          ? "Pending"
                          : item.rsvpStatus === "ACCEPTED"
                            ? "Accepted"
                            : "Declined"}
                      </span>
                    </td>
                    <td
                      role="cell"
                      className="invitation-invitees-cell"
                      data-label="Named guests"
                    >
                      {item.inviteeCount}
                    </td>
                    <td
                      role="cell"
                      className="invitation-activity-cell"
                      data-label="Opening activity"
                    >
                      <span>
                        {item.openCount === 0
                          ? "Not opened"
                          : `${item.openCount} ${item.openCount === 1 ? "open" : "opens"}`}
                      </span>
                      <details className="invitation-row-history">
                        <summary>History and deadline</summary>
                        <dl>
                          <dt>Last opened</dt>
                          <dd>
                            <DateValue
                              value={item.lastOpenedAt}
                              empty="Not opened"
                            />
                          </dd>
                          <dt>RSVP deadline</dt>
                          <dd>
                            <DateValue
                              value={item.rsvpDeadlineAt}
                              empty="Wedding default"
                            />
                          </dd>
                        </dl>
                      </details>
                    </td>
                    <td
                      role="cell"
                      data-label="Sharing"
                      className="invitation-sharing-cell"
                    >
                      {item.status !== "ACTIVE" ? (
                        <span>Unavailable for archived invitations</span>
                      ) : data.publicInvitationOrigin ? (
                        <InvitationRowSharing
                          invitationId={item.id}
                          publicInvitationOrigin={data.publicInvitationOrigin}
                        />
                      ) : (
                        <span>Sharing unavailable</span>
                      )}
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
  return (
    <>
      <InvitationOverview overview={result.data.overview} />
      <InvitationFilters
        query={query}
        events={result.data.overview.events.map(({ id, name, isActive }) => ({
          id,
          name,
          isActive,
        }))}
      />
      <InvitationList data={result.data} query={query} />
    </>
  );
}
