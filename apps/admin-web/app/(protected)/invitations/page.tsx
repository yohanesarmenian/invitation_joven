import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../src/auth/server-session";
import {
  parseInvitationQuery,
  queryString,
  type SearchParams,
} from "../../../src/invitations/query";
import { InvitationResults } from "../../../components/invitation-list";
import { InvitationFilters } from "../../../components/invitation-filters";
export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if ((await getServerSession()).kind !== "authenticated") return null;
  const params = await searchParams;
  const query = parseInvitationQuery(params);
  if (
    query &&
    typeof params.search === "string" &&
    params.search !== (query.search ?? "")
  )
    redirect(`/invitations?${queryString(query)}`);
  return (
    <>
      <header className="dashboard-heading invitation-heading">
        <div>
          <p className="eyebrow">Guest management</p>
          <h1>Invitations</h1>
          <p>Manage your guest list and follow RSVP activity.</p>
        </div>
        <div className="invitation-actions">
          <Link
            className="invitation-secondary"
            href="/invitations/import"
            prefetch={false}
          >
            Import CSV/XLSX
          </Link>
          <Link
            className="invitation-primary"
            href="/invitations/new"
            prefetch={false}
          >
            New invitation
          </Link>
        </div>
      </header>
      {!query ? (
        <section className="dashboard-error" role="alert">
          <h2>Invalid search or filters</h2>
          <p>This address contains unsupported query values.</p>
          <Link href="/invitations" prefetch={false}>
            Reset search and filters
          </Link>
        </section>
      ) : (
        <>
          {params.created === "1" && (
            <p className="notice" role="status">
              Invitation created.
            </p>
          )}
          <InvitationFilters
            key={"filters-" + queryString(query)}
            query={query}
          />
          <Suspense
            key={"results-" + queryString(query)}
            fallback={<p role="status">Loading invitations…</p>}
          >
            <InvitationResults query={query} />
          </Suspense>
        </>
      )}
    </>
  );
}
