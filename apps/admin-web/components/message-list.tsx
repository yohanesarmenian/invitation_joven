import Link from "next/link";
import { redirect } from "next/navigation";
import type { AdminGuestMessageListResponse } from "@wedding-invitation/api-client/src/index";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { getGuestMessages } from "../src/messages/server-messages";
import { messageListHref, type MessageQuery } from "../src/messages/query";
import { MessageModerationActions } from "./message-moderation-actions";

export function MessageReadError({
  forbidden,
  href,
  notFound,
}: {
  forbidden?: boolean;
  href: string;
  notFound?: boolean;
}) {
  return (
    <section className="dashboard-error" role="alert">
      <h2>
        {notFound
          ? "Invitation messages not found"
          : forbidden
            ? "Message access unavailable"
            : "Unable to load messages"}
      </h2>
      <p>
        {notFound
          ? "The requested invitation could not be found."
          : forbidden
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

function filterDescription(query: MessageQuery) {
  const visibility =
    query.hidden === "all"
      ? "all visibility states"
      : query.hidden === "visible"
        ? "visible messages"
        : "hidden messages";
  return query.invitationId
    ? `${visibility} for this invitation`
    : `${visibility} across invitations`;
}

export function MessageList({
  csrfToken,
  data,
  query,
}: {
  csrfToken: string;
  data: AdminGuestMessageListResponse;
  query: MessageQuery;
}) {
  const { items, page } = data;
  const scopedInvitation = query.invitationId
    ? items.find((item) => item.invitation.id === query.invitationId)
        ?.invitation
    : undefined;
  const filtered = query.hidden !== "all" || Boolean(query.invitationId);
  const refreshHref = messageListHref(query, query.page);
  return (
    <section aria-label="Guest message results" className="invitation-results">
      <div className="results-heading">
        <h2>{scopedInvitation?.displayName ?? "Guest messages"}</h2>
        <p>
          {page.totalItems} {page.totalItems === 1 ? "message" : "messages"} in{" "}
          {filterDescription(query)}
        </p>
        {query.invitationId && (
          <p className="hint">
            Scoped to invitation{" "}
            <Link href={`/invitations/${query.invitationId}`} prefetch={false}>
              {scopedInvitation?.displayName ?? query.invitationId}
            </Link>
            .
          </p>
        )}
      </div>
      {!items.length ? (
        <div className="invitation-empty">
          <h3>
            {page.totalItems > 0
              ? "No messages on this page"
              : filtered
                ? "No matching messages"
                : "No guest messages yet"}
          </h3>
          <p>
            {page.totalItems > 0
              ? "This page is beyond the current results. Return to the first page to see messages."
              : filtered
                ? "Clear or change the message filters."
                : "Messages will appear here after guests submit them from their public invitation."}
          </p>
          <Link
            href={page.totalItems > 0 || filtered ? messageListHref(query, 1) : "/"}
            prefetch={false}
          >
            {page.totalItems > 0 || filtered
              ? "First page"
              : "Back to dashboard"}
          </Link>
        </div>
      ) : (
        <>
          <p className="hint" id="message-table-help">
            Dates are shown in Asia/Jakarta (UTC+07:00). Guest-authored content
            is rendered as text.
          </p>
          <div
            className="invitation-table-scroll"
            role="region"
            aria-label="Guest messages table"
            aria-describedby="message-table-help"
            tabIndex={0}
          >
            <table className="invitation-table message-table">
              <caption className="sr-only">
                Guest messages with invitation context and moderation controls
              </caption>
              <thead>
                <tr>
                  <th scope="col">Invitation</th>
                  <th scope="col">Author</th>
                  <th scope="col">Message</th>
                  <th scope="col">Visibility</th>
                  <th scope="col">Created</th>
                  <th scope="col">Moderation</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      <Link
                        href={`/invitations/${item.invitation.id}`}
                        prefetch={false}
                      >
                        {item.invitation.displayName}
                      </Link>
                      <span className="greeting-name">{item.invitation.id}</span>
                    </th>
                    <td>{item.authorName ?? "Anonymous guest"}</td>
                    <td>
                      <p className="guest-message-text">{item.message}</p>
                    </td>
                    <td>
                      <span className="status-label">
                        {item.isHidden ? "Hidden" : "Visible"}
                      </span>
                    </td>
                    <td>
                      <DateValue value={item.createdAt} />
                    </td>
                    <td>
                      <MessageModerationActions
                        csrfToken={csrfToken}
                        isHidden={item.isHidden}
                        messageId={item.id}
                        refreshHref={refreshHref}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <nav className="invitation-pagination" aria-label="Message pagination">
        <p>
          Page {page.number} - {page.totalPages}{" "}
          {page.totalPages === 1 ? "page" : "pages"} of results
        </p>
        <div>
          {page.number > 1 ? (
            <Link
              prefetch={false}
              href={messageListHref(query, page.number - 1)}
            >
              Previous
            </Link>
          ) : (
            <span aria-disabled="true">Previous</span>
          )}
          {page.number < page.totalPages ? (
            <Link
              prefetch={false}
              href={messageListHref(query, page.number + 1)}
            >
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

export async function MessageResults({
  csrfToken,
  query,
}: {
  csrfToken: string;
  query: MessageQuery;
}) {
  const result = await getGuestMessages(query);
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (result.kind !== "ready")
    return (
      <MessageReadError
        forbidden={result.kind === "forbidden"}
        notFound={result.kind === "not-found"}
        href={messageListHref(query, query.page)}
      />
    );
  return <MessageList csrfToken={csrfToken} data={result.data} query={query} />;
}
