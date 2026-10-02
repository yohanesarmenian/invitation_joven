import type { AdminDashboardResponse } from "@wedding-invitation/api-client/src/index";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
export function Dashboard({ data }: { data: AdminDashboardResponse }) {
  return (
    <div className="dashboard-sections">
      <section
        className="dashboard-section"
        aria-labelledby="invitations-heading"
      >
        <div className="section-heading">
          <h2 id="invitations-heading">Invitations</h2>
          <p>Invitation status and first opens.</p>
        </div>
        <dl className="metric-grid">
          <Metric label="Active Invitations" value={data.invitations.active} />
          <Metric
            label="Archived Invitations"
            value={data.invitations.archived}
          />
          <Metric
            label="Opened Active Invitations"
            value={data.invitations.openedActive}
          />
        </dl>
      </section>
      <section className="dashboard-section" aria-labelledby="rsvp-heading">
        <div className="section-heading">
          <h2 id="rsvp-heading">RSVP status</h2>
          <p>Responses for active invitations.</p>
        </div>
        <dl className="metric-grid rsvp-metrics">
          <Metric label="Pending" value={data.rsvp.pending} />
          <Metric label="Accepted" value={data.rsvp.accepted} />
          <Metric label="Declined" value={data.rsvp.declined} />
        </dl>
      </section>
      <section
        className="dashboard-section attendance-section"
        aria-labelledby="attendance-heading"
      >
        <div className="section-heading">
          <h2 id="attendance-heading">Expected attendance by Event</h2>
          <p>Attending guests from accepted RSVPs for active invitations.</p>
        </div>
        {data.expectedByEvent.length ? (
          <table className="attendance-table">
            <caption className="sr-only">Expected attendance by Event</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Expected attendees</th>
              </tr>
            </thead>
            <tbody>
              {data.expectedByEvent.map((row) => (
                <tr key={row.event.id}>
                  <th scope="row">{row.event.name}</th>
                  <td>{row.expectedAttendeeCount.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dashboard-empty">
            <p>No accepted attending RSVPs yet.</p>
            <p>
              Expected attendance will appear here when guests accept and select
              an event.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export function DashboardLoading() {
  return (
    <div className="dashboard-loading" role="status">
      <p>Loading dashboard…</p>
      <div className="loading-grid" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} />
        ))}
      </div>
    </div>
  );
}

export function DashboardError({ forbidden = false }: { forbidden?: boolean }) {
  return (
    <section
      className="dashboard-error"
      aria-labelledby="dashboard-error-title"
    >
      <h2 id="dashboard-error-title">
        {forbidden
          ? "Dashboard access unavailable"
          : "Unable to load dashboard"}
      </h2>
      <p role="alert">
        {forbidden
          ? "You are not authorized to view this dashboard."
          : "We couldn’t retrieve the latest counts. Please try again."}
      </p>
      {/* A full reload must re-run both auth and the failed read, bypassing the router cache. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="dashboard-retry" href="/">
        Try again
      </a>
    </section>
  );
}
