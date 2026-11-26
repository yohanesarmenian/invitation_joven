import Link from "next/link";
import type { ReactNode } from "react";
import type {
  AdminEventsResponse,
  AdminInvitationDetailResponse,
} from "@wedding-invitation/api-client/src/index";
import { InviteeEventManagement } from "./invitee-event-management";
import { InvitationActions } from "./invitation-actions";
import { PersonalInviteMessage } from "./personal-invite-message";
import { InvitationRowSharing } from "./invitation-row-sharing";
import { InvitationSessionLabels } from "./invitation-session-labels";

type Invitation = AdminInvitationDetailResponse["invitation"];
type EventOption = AdminEventsResponse["events"][number];

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function DateValue({ empty, value }: { empty: string; value: string | null }) {
  return value ? (
    <time dateTime={value}>{dateFormat.format(new Date(value))}</time>
  ) : (
    <span>{empty}</span>
  );
}

function BoolValue({ value }: { value: boolean }) {
  return <span>{value ? "Yes" : "No"}</span>;
}

function DefinitionList({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="detail-list">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InvitationDetail({
  csrfToken,
  events,
  invitation,
  publicInvitationOrigin,
}: {
  csrfToken: string;
  events: EventOption[];
  invitation: Invitation;
  publicInvitationOrigin?: string | null;
}) {
  return (
    <div className="invitation-detail">
      <nav
        className="invitation-section-nav"
        aria-label="Invitation detail sections"
      >
        <a href="#invitation-overview">Overview</a>
        <a href="#guest-management">Guests and sessions</a>
        <a href="#invitation-activity">Activity and RSVP</a>
        <a href="#sharing">Sharing</a>
        <a href="#invitation-advanced">Advanced settings</a>
      </nav>
      <section className="detail-section" aria-labelledby="invitation-overview">
        <div className="section-heading">
          <h2 id="invitation-overview" tabIndex={-1}>
            Invitation identity
          </h2>
        </div>
        <DefinitionList
          rows={[
            { label: "Display name", value: invitation.displayName },
            {
              label: "Greeting name",
              value: invitation.greetingName ?? "Not set",
            },
            {
              label: "Status",
              value: (
                <span className="status-label">
                  {invitation.status === "ACTIVE" ? "Active" : "Archived"}
                </span>
              ),
            },
            {
              label: "RSVP status",
              value: invitation.rsvp?.status.toLowerCase() ?? "Pending",
            },
            {
              label: "Eligible sessions",
              value: (
                <InvitationSessionLabels
                  sessions={invitation.eligibility.map(({ event }) => event)}
                  empty="No eligible sessions"
                />
              ),
            },
            {
              label: "Created",
              value: <DateValue value={invitation.createdAt} empty="" />,
            },
            {
              label: "Updated",
              value: <DateValue value={invitation.updatedAt} empty="" />,
            },
            {
              label: "Archived",
              value: (
                <DateValue value={invitation.archivedAt} empty="Not archived" />
              ),
            },
            { label: "Internal notes", value: invitation.notes ?? "None" },
          ]}
        />
      </section>
      <section
        className="invitation-guest-group"
        aria-labelledby="guest-management"
      >
        <h2 id="guest-management" tabIndex={-1}>
          Guests and eligible sessions
        </h2>
        <InviteeEventManagement
          key={`${invitation.id}:${invitation.eligibility
            .map(({ event }) => event.id)
            .sort()
            .join(",")}`}
          csrfToken={csrfToken}
          events={events}
          invitation={invitation}
        />
      </section>
      <section className="detail-section" aria-labelledby="invitation-activity">
        <div className="section-heading">
          <h2 id="invitation-activity" tabIndex={-1}>
            RSVP, messages, and activity
          </h2>
          <p>Bounded summary only.</p>
        </div>
        <DefinitionList
          rows={[
            {
              label: "RSVP",
              value: invitation.rsvp
                ? invitation.rsvp.status.toLowerCase()
                : "No RSVP yet",
            },
            {
              label: "Attending per saved RSVP",
              value: (
                <InvitationSessionLabels
                  sessions={invitation.rsvp?.attendingEvents ?? []}
                  empty="No sessions marked attending"
                />
              ),
            },
            {
              label: "RSVP submitted",
              value: (
                <DateValue
                  value={invitation.rsvp?.submittedAt ?? null}
                  empty="Not submitted"
                />
              ),
            },
            {
              label: "RSVP updated",
              value: (
                <DateValue
                  value={invitation.rsvp?.lastUpdatedAt ?? null}
                  empty="Not updated"
                />
              ),
            },
            {
              label: "Guest messages",
              value: (
                <>
                  {invitation.messages.total} total,{" "}
                  {invitation.messages.hidden} hidden
                  <Link
                    className="detail-inline-link"
                    href={`/messages?invitationId=${invitation.id}`}
                    prefetch={false}
                  >
                    View messages
                  </Link>
                </>
              ),
            },
            { label: "Open count", value: invitation.openCount },
            {
              label: "First opened",
              value: (
                <DateValue
                  value={invitation.firstOpenedAt}
                  empty="Not opened"
                />
              ),
            },
            {
              label: "Last opened",
              value: (
                <DateValue value={invitation.lastOpenedAt} empty="Not opened" />
              ),
            },
          ]}
        />
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Check-in pass lifecycle</h2>
          <p>Safe metadata only.</p>
        </div>
        {invitation.checkinPasses.length ? (
          <div className="detail-table-scroll">
            <table className="detail-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Credential version</th>
                  <th scope="col">Issued</th>
                  <th scope="col">Revoked</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              <tbody>
                {invitation.checkinPasses.map((pass, index) => (
                  <tr key={`${pass.status}-${pass.issuedAt}-${index}`}>
                    <th scope="row">{pass.status}</th>
                    <td>{pass.credentialVersion}</td>
                    <td>
                      <DateValue value={pass.issuedAt} empty="" />
                    </td>
                    <td>
                      <DateValue value={pass.revokedAt} empty="Not revoked" />
                    </td>
                    <td>{pass.revocationReason ?? "None"}</td>
                    <td>
                      <DateValue value={pass.expiresAt} empty="No expiry" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No check-in pass history.</p>
        )}
      </section>
      <section
        id="sharing"
        tabIndex={-1}
        className="detail-section"
        aria-labelledby="invitation-sharing-heading"
      >
        <h2 id="invitation-sharing-heading">Sharing</h2>
        {invitation.status === "ACTIVE" ? (
          <>
            {publicInvitationOrigin && (
              <InvitationRowSharing
                invitationId={invitation.id}
                publicInvitationOrigin={publicInvitationOrigin}
                showPersonalMessage={false}
              />
            )}
            <PersonalInviteMessage
              key={invitation.updatedAt}
              invitationId={invitation.id}
              context={{
                greeting: invitation.greetingName ?? invitation.displayName,
                deadline: invitation.rsvpDeadlineAt,
                events: invitation.eligibility.map(
                  (item) =>
                    events.find((event) => event.id === item.event.id) ??
                    item.event,
                ),
              }}
            />
          </>
        ) : (
          <p>Sharing is unavailable for this archived invitation.</p>
        )}
      </section>
      <div
        id="invitation-advanced"
        tabIndex={-1}
        className="invitation-guest-group"
      >
        <section className="detail-section">
          <div className="section-heading">
            <h2>Invitation settings</h2>
            <p>Guest rules and public-link version metadata.</p>
          </div>
          <DefinitionList
            rows={[
              {
                label: "Allow plus-one",
                value: <BoolValue value={invitation.allowPlusOne} />,
              },
              {
                label: "Maximum additional children",
                value: invitation.maxAdditionalChildren,
              },
              {
                label: "RSVP deadline",
                value: (
                  <DateValue
                    value={invitation.rsvpDeadlineAt}
                    empty="Wedding default (see Reports)"
                  />
                ),
              },
              {
                label: "Public token version",
                value: invitation.publicTokenVersion,
              },
            ]}
          />
        </section>
        <InvitationActions
          archivedAt={invitation.archivedAt}
          csrfToken={csrfToken}
          invitationId={invitation.id}
          publicTokenVersion={invitation.publicTokenVersion}
          status={invitation.status}
        />
      </div>
      <div className="detail-actions">
        {invitation.status === "ACTIVE" && (
          <Link
            className="invitation-primary"
            href={`/invitations/${invitation.id}/edit`}
            prefetch={false}
          >
            Edit invitation
          </Link>
        )}
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </div>
    </div>
  );
}
