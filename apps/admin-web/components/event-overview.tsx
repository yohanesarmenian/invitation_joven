import type { EventOverview, ManagedEvent } from "../src/events/client";

const wib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "short",
  hourCycle: "h23",
});
const materialLabels: Record<EventOverview["parking"], string> = {
  missing: "Not configured · optional",
  draft: "Saved draft · not published",
  published: "Published",
  changed: "Published · draft differs",
  unavailable: "Unavailable",
};

export function EventFacts({
  event,
  overview,
}: {
  event: ManagedEvent;
  overview?: EventOverview;
}) {
  return (
    <dl className="event-facts">
      <div>
        <dt>Schedule (WIB)</dt>
        <dd>
          {event.startsAt ? (
            <time dateTime={event.startsAt}>
              {wib.format(new Date(event.startsAt))}
            </time>
          ) : (
            "Start missing"
          )}
          {" → "}
          {event.endsAt ? (
            <time dateTime={event.endsAt}>
              {wib.format(new Date(event.endsAt))}
            </time>
          ) : (
            "No end time"
          )}
        </dd>
      </div>
      <div>
        <dt>Venue</dt>
        <dd>
          {event.venueName || "Missing"}
          {event.address ? (
            <>
              <br />
              {event.address}
            </>
          ) : (
            <>
              <br />
              Address missing
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Google Maps</dt>
        <dd>{event.googleMapsUrl ? "Configured" : "Missing · optional"}</dd>
      </div>
      <div>
        <dt>Active eligible households</dt>
        <dd>{overview?.activeEligibleHouseholds ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>RSVP accepted households</dt>
        <dd>{overview?.acceptedHouseholds ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>RSVP confirmed people</dt>
        <dd>{overview?.confirmedPeople ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>Parking</dt>
        <dd>{materialLabels[overview?.parking ?? "unavailable"]}</dd>
      </div>
      <div>
        <dt>Rundown</dt>
        <dd>{materialLabels[overview?.rundown ?? "unavailable"]}</dd>
      </div>
    </dl>
  );
}

export function EventReadiness({
  event,
  overview,
}: {
  event: ManagedEvent;
  overview?: EventOverview;
}) {
  return (
    <section aria-label="Configuration readiness">
      <h3>Configuration readiness</h3>
      <ul className="event-readiness">
        <li>Start date/time · {event.startsAt ? "Configured" : "Missing"}</li>
        <li>End date/time · {event.endsAt ? "Configured" : "Optional"}</li>
        <li>Venue · {event.venueName ? "Configured" : "Missing"}</li>
        <li>Address · {event.address ? "Configured" : "Missing"}</li>
        <li>
          Google Maps ·{" "}
          {event.googleMapsUrl ? "Configured" : "Missing · optional"}
        </li>
        <li>Parking · {materialLabels[overview?.parking ?? "unavailable"]}</li>
        <li>Rundown · {materialLabels[overview?.rundown ?? "unavailable"]}</li>
      </ul>
      {overview?.parking === "changed" || overview?.rundown === "changed" ? (
        <p>
          Guests still see the published snapshot until you publish a new one.
        </p>
      ) : null}
    </section>
  );
}
