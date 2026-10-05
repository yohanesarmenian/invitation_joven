import Link from "next/link";
import type { ReactNode } from "react";
import type {
  AdminEventsResponse,
  AdminInvitationDetailResponse,
} from "@wedding-invitation/api-client/src/index";
import { InviteeEventManagement } from "./invitee-event-management";
import { InvitationActions } from "./invitation-actions";

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
}: {
  csrfToken: string;
  events: EventOption[];
  invitation: Invitation;
}) {
  return (
    <div className="invitation-detail">
      <section className="detail-section">
        <div className="section-heading">
          <h2>Invitation identity</h2>
          <p>Operational status and internal notes.</p>
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
                <DateValue
                  value={invitation.archivedAt}
                  empty="Not archived"
                />
              ),
            },
            { label: "Internal notes", value: invitation.notes ?? "None" },
          ]}
        />
      </section>
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
                  empty="No deadline"
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
      <InviteeEventManagement
        csrfToken={csrfToken}
        events={events}
        invitation={invitation}
      />
      <section className="detail-section">
        <div className="section-heading">
          <h2>RSVP, messages, and activity</h2>
          <p>Bounded summary only.</p>
        </div>
        <DefinitionList
          rows={[
            {
              label: "RSVP",
              value: invitation.rsvp
                ? `${invitation.rsvp.status.toLowerCase()} v${invitation.rsvp.version}`
                : "No RSVP yet",
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
              value: `${invitation.messages.total} total, ${invitation.messages.hidden} hidden`,
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
      <InvitationActions
        archivedAt={invitation.archivedAt}
        csrfToken={csrfToken}
        invitationId={invitation.id}
        publicTokenVersion={invitation.publicTokenVersion}
        status={invitation.status}
      />
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
