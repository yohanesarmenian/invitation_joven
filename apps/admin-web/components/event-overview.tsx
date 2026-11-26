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

function materialLabel(state: EventOverview["parking"], isActive: boolean) {
  if (isActive) return materialLabels[state];
  if (state === "published")
    return "Published snapshot retained · hidden from guests";
  if (state === "changed")
    return "Published snapshot retained · draft differs · hidden from guests";
  return materialLabels[state];
}

export function publishedMaterialVisibility(isActive: boolean) {
  return isActive
    ? "Published materials are available to eligible guests with valid invitation access."
    : "The published snapshot is retained. Guests cannot view materials for this inactive event.";
}

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
        <dt>Active eligible invited households</dt>
        <dd>{overview?.activeEligibleHouseholds ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>RSVP accepted invited households</dt>
        <dd>{overview?.acceptedHouseholds ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>RSVP confirmed people (invited)</dt>
        <dd>{overview?.confirmedPeople ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>Parking</dt>
        <dd>
          {materialLabel(overview?.parking ?? "unavailable", event.isActive)}
        </dd>
      </div>
      <div>
        <dt>Rundown</dt>
        <dd>
          {materialLabel(overview?.rundown ?? "unavailable", event.isActive)}
        </dd>
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
  const states = [overview?.parking, overview?.rundown];
  const hasPublication =
    states.includes("published") || states.includes("changed");
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
        <li>
          Parking ·{" "}
          {materialLabel(overview?.parking ?? "unavailable", event.isActive)}
        </li>
        <li>
          Rundown ·{" "}
          {materialLabel(overview?.rundown ?? "unavailable", event.isActive)}
        </li>
      </ul>
      {hasPublication ? (
        <p>{publishedMaterialVisibility(event.isActive)}</p>
      ) : null}
      {states.includes("changed") ? (
        <p>Draft changes require a new publication.</p>
      ) : null}
    </section>
  );
}
