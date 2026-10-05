import Link from "next/link";
import { Suspense } from "react";
import { getServerSession } from "../../../src/auth/server-session";
import {
  messageQueryString,
  parseMessageQuery,
  type SearchParams,
} from "../../../src/messages/query";
import { MessageFilters } from "../../../components/message-filters";
import { MessageResults } from "../../../components/message-list";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession();
  if (session.kind !== "authenticated") return null;
  const params = await searchParams;
  const query = parseMessageQuery(params);
  return (
    <>
      <header className="dashboard-heading invitation-heading">
        <div>
          <p className="eyebrow">Guest management</p>
          <h1>Messages</h1>
          <p>Review guest-submitted messages and moderation visibility.</p>
        </div>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </header>
      {!query ? (
        <section className="dashboard-error" role="alert">
          <h2>Invalid message filters</h2>
          <p>This address contains unsupported query values.</p>
          <Link href="/messages" prefetch={false}>
            Reset message filters
          </Link>
        </section>
      ) : (
        <>
          <MessageFilters query={query} />
          <Suspense
            key={"results-" + messageQueryString(query)}
            fallback={<p role="status">Loading messages...</p>}
          >
            <MessageResults csrfToken={session.auth.csrfToken} query={query} />
          </Suspense>
        </>
      )}
    </>
  );
}
