import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminRsvpDetailResponse } from "@wedding-invitation/api-client/src/index";

type Rsvp = AdminRsvpDetailResponse["rsvp"];

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

function statusLabel(status: Rsvp["status"]) {
  return status === "PENDING"
    ? "Pending"
    : status === "ACCEPTED"
      ? "Accepted"
      : "Declined";
}

function attendeeLabel(type: Rsvp["attendees"][number]["type"]) {
  return type === "NAMED_INVITEE"
    ? "Named invitee"
    : type === "PLUS_ONE"
      ? "Plus-one"
      : "Additional child";
}

export function RsvpDetail({ rsvp }: { rsvp: Rsvp }) {
  return (
    <div className="invitation-detail">
      <section className="detail-section">
        <div className="section-heading">
          <h2>RSVP summary</h2>
          <p>Current persisted RSVP state.</p>
        </div>
        <DefinitionList
          rows={[
            {
              label: "Status",
              value: (
                <span className="status-label">
                  {statusLabel(rsvp.status)} v{rsvp.version}
                </span>
              ),
            },
            {
              label: "Submitted",
              value: (
                <DateValue value={rsvp.submittedAt} empty="Not submitted" />
              ),
            },
            {
              label: "Created",
              value: <DateValue value={rsvp.createdAt} empty="" />,
            },
            {
              label: "Updated",
              value: <DateValue value={rsvp.updatedAt} empty="" />,
            },
          ]}
        />
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Invitation context</h2>
          <p>Bounded invitation identity.</p>
        </div>
        <DefinitionList
          rows={[
            { label: "Display name", value: rsvp.invitation.displayName },
            {
              label: "Invitation status",
              value:
                rsvp.invitation.status === "ACTIVE" ? "Active" : "Archived",
            },
            {
              label: "Invitation",
              value: (
                <Link
                  href={`/invitations/${rsvp.invitation.id}`}
                  prefetch={false}
                >
                  Open invitation detail
                </Link>
              ),
            },
          ]}
        />
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Attendee snapshots</h2>
          <p>Submitted RSVP attendee rows, not current invitee records.</p>
        </div>
        {rsvp.attendees.length ? (
          <div className="detail-table-scroll">
            <table className="detail-table">
              <thead>
                <tr>
                  <th scope="col">Attendee</th>
                  <th scope="col">Type</th>
                  <th scope="col">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {rsvp.attendees.map((attendee, index) => (
                  <tr
                    key={`${attendee.type}-${attendee.inviteeId ?? "dynamic"}-${index}`}
                  >
                    <th scope="row">
                      {attendee.displayName ?? attendeeLabel(attendee.type)}
                    </th>
                    <td>{attendeeLabel(attendee.type)}</td>
                    <td>{attendee.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No attendee rows.</p>
        )}
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Event selections</h2>
          <p>Persisted attendance choices and expected counts.</p>
        </div>
        {rsvp.eventSelections.length ? (
          <div className="detail-table-scroll">
            <table className="detail-table">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Attending</th>
                  <th scope="col">Expected attendees</th>
                </tr>
              </thead>
              <tbody>
                {rsvp.eventSelections.map((selection) => (
                  <tr key={selection.event.id}>
                    <th scope="row">
                      {selection.event.name}
                      {!selection.event.isActive && (
                        <span className="event-state">Inactive</span>
                      )}
                    </th>
                    <td>{selection.attending ? "Yes" : "No"}</td>
                    <td>{selection.expectedAttendeeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No event selections.</p>
        )}
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Notes</h2>
          <p>Household RSVP notes only. Guest messages are separate.</p>
        </div>
        <DefinitionList
          rows={[
            {
              label: "Dietary notes",
              value: rsvp.dietaryNotes ?? "No dietary notes",
            },
            { label: "Guest note", value: rsvp.guestNote ?? "No guest note" },
          ]}
        />
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Admin attribution</h2>
          <p>Current-state OWNER attribution only.</p>
        </div>
        <DefinitionList
          rows={[
            {
              label: "Submitted by admin",
              value: rsvp.submittedByAdmin ? "Yes" : "No",
            },
            {
              label: "Admin user",
              value: rsvp.adminUser?.email ?? "None",
            },
            {
              label: "Override reason",
              value: rsvp.overrideReason ?? "None",
            },
          ]}
        />
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Check-in pass lifecycle</h2>
          <p>Safe metadata only. QR credentials are not rendered.</p>
        </div>
        {rsvp.checkinPasses.length ? (
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
                {rsvp.checkinPasses.map((pass, index) => (
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
      <div className="detail-actions">
        <Link href="/rsvps" prefetch={false}>
          Back to RSVPs
        </Link>
      </div>
    </div>
  );
}
