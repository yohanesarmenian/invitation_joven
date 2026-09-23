import type { PublicInvitationResponse } from "../../../../packages/api-client/src/index";

type PublicInvitation = PublicInvitationResponse["invitation"];
type PublicInvitationEvent = PublicInvitation["events"][number];
type DisplayInvitationEvent = Pick<
  PublicInvitationEvent,
  "address" | "googleMapsUrl" | "name" | "startsAt" | "venueName"
>;

export type PublicInvitationLongPageModel = {
  displayName: PublicInvitation["displayName"];
  events: DisplayInvitationEvent[];
  greetingName: PublicInvitation["greetingName"];
  rsvpDeadlineAt: PublicInvitation["rsvpDeadlineAt"];
};

const dressCodeSwatches = [
  { label: "Deep navy", color: "#11256E" },
  { label: "Soft blue", color: "#6082FF" },
  { label: "Warm cream", color: "#FFE8BB" },
  { label: "Modern grey", color: "#9B9A99" },
  { label: "Fresh teal", color: "#02ACA1" },
];

const invitationEventTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

export function PublicInvitationLongPage({
  invitation,
}: {
  invitation: PublicInvitationLongPageModel;
}) {
  const guestName = invitation.greetingName ?? invitation.displayName;

  return (
    <main className="public-invitation-page" aria-labelledby="invitation-title">
      <article className="public-invitation-surface">
        <InvitationHeader guestName={guestName} />
        <CoupleSection />
        <WeddingDateSection />
        <EventsSection events={invitation.events} />
        <DressCodeSection />
        <RsvpInformationSection deadline={invitation.rsvpDeadlineAt} />
        <GallerySection />
        <QuoteSection />
        <GuestMessageSection />
        <ClosingSection />
      </article>
    </main>
  );
}

function InvitationHeader({ guestName }: { guestName: string }) {
  return (
    <header className="invitation-section invitation-header">
      <p className="section-kicker">Dear</p>
      <h1 id="invitation-title">{guestName}</h1>
      <p>
        we joyfully invite you to witness and celebrate as we unite in the
        Sacrament of Holy Matrimony.
      </p>
    </header>
  );
}

function CoupleSection() {
  return (
    <section className="invitation-section couple-section" aria-labelledby="couple-title">
      <h2 id="couple-title" className="visually-hidden">
        Bride and Groom
      </h2>
      <CoupleProfile role="Bride" name="Jo" mediaSide="left" />
      <CoupleProfile role="Groom" name="Venta" mediaSide="right" />
    </section>
  );
}

function CoupleProfile({
  role,
  name,
  mediaSide,
}: {
  role: string;
  name: string;
  mediaSide: "left" | "right";
}) {
  const titleId = `${role.toLowerCase()}-title`;
  const media = <div className="couple-media-slot" aria-hidden="true" />;
  const copy = (
    <div className="couple-copy">
      <p className="section-kicker">{role}</p>
      <h3 id={titleId}>{name}</h3>
    </div>
  );

  return (
    <section className="couple-profile" aria-labelledby={titleId}>
      {mediaSide === "left" ? media : copy}
      {mediaSide === "left" ? copy : media}
    </section>
  );
}

function WeddingDateSection() {
  return (
    <section className="invitation-section wedding-date-section" aria-labelledby="wedding-date-title">
      <p className="section-kicker">Wedding Date</p>
      <h2 id="wedding-date-title">Saturday, 09 January 2027</h2>
    </section>
  );
}

function EventsSection({ events }: { events: DisplayInvitationEvent[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section className="invitation-section events-section" aria-labelledby="events-title">
      <h2 id="events-title">Wedding Events</h2>
      <div className="event-list">
        {events.map((event, index) => (
          <EventSection key={`${event.name}-${index}`} event={event} index={index} />
        ))}
      </div>
    </section>
  );
}

function EventSection({
  event,
  index,
}: {
  event: DisplayInvitationEvent;
  index: number;
}) {
  const timeLabel = formatInvitationEventTime(event.startsAt);
  const titleId = `event-title-${index + 1}`;

  return (
    <section className="event-card" aria-labelledby={titleId}>
      <div className="event-time-block">
        {timeLabel ? (
          <time dateTime={event.startsAt ?? undefined}>{timeLabel}</time>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
      <div className="event-detail-block">
        <h3 id={titleId}>{event.name}</h3>
        {event.venueName ? <p className="event-venue">{event.venueName}</p> : null}
        {event.address ? <address>{event.address}</address> : null}
        <div className="event-actions">
          {event.googleMapsUrl ? (
            <a
              className="map-link"
              href={event.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View in Google Maps
            </a>
          ) : null}
          <span className="parking-guide-note">Parking guide deferred</span>
        </div>
      </div>
    </section>
  );
}

function DressCodeSection() {
  return (
    <section className="invitation-section dress-code-section" aria-labelledby="dress-code-title">
      <p className="section-kicker">Fine Attire</p>
      <h2 id="dress-code-title">Dress Code</h2>
      <p>Formal / Modern / National / Batik</p>
      <ul className="dress-swatch-list" aria-label="Dress code color references">
        {dressCodeSwatches.map((swatch) => (
          <li key={swatch.color}>
            <span
              className="dress-swatch"
              style={{ backgroundColor: swatch.color }}
              aria-hidden="true"
            />
            <span>{swatch.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RsvpInformationSection({ deadline }: { deadline: string | null }) {
  const deadlineLabel = formatIsoDatePortion(deadline);

  return (
    <section className="invitation-section rsvp-information-section" aria-labelledby="rsvp-title">
      <h2 id="rsvp-title">RSVP &amp; Dietary Information</h2>
      <p>
        RSVP and dietary details will be handled in a later step. This section
        is currently read-only.
      </p>
      {deadlineLabel ? <p className="deadline-copy">Kindly reply by {deadlineLabel}.</p> : null}
    </section>
  );
}

function GallerySection() {
  return (
    <section className="invitation-section gallery-section" aria-labelledby="gallery-title">
      <h2 id="gallery-title">Pre-wedding Gallery</h2>
      <div className="gallery-mosaic" aria-hidden="true">
        <div className="gallery-frame gallery-frame-large" />
        <div className="gallery-frame gallery-frame-small" />
        <div className="gallery-frame gallery-frame-medium" />
        <div className="gallery-frame gallery-frame-tall" />
      </div>
    </section>
  );
}

function QuoteSection() {
  return (
    <section className="invitation-section quote-section" aria-labelledby="quote-title">
      <h2 id="quote-title">Scripture &amp; Words</h2>
      <blockquote>
        <p>We love because He first loved us.</p>
        <cite>1 John 4:19</cite>
      </blockquote>
      <blockquote>
        <p>Happiness is only real when shared</p>
        <cite>Christopher McCandless</cite>
      </blockquote>
    </section>
  );
}

function GuestMessageSection() {
  return (
    <section className="invitation-section guest-message-section" aria-labelledby="message-title">
      <h2 id="message-title">Leave a Message for the Bride &amp; Groom</h2>
      <p>Guest messages will be available in a later phase.</p>
    </section>
  );
}

function ClosingSection() {
  return (
    <footer className="invitation-section invitation-footer">
      <p className="closing-copy">See you at the Wedding!</p>
      <p>Handcrafted with love by Angelina &amp; Yohanes</p>
      <p>100% human made, no AI.</p>
    </footer>
  );
}

function formatIsoDatePortion(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  if (isoDate === null) {
    return null;
  }

  return isoDate;
}

function formatInvitationEventTime(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = invitationEventTimeFormatter.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (hour === undefined || minute === undefined) {
    return null;
  }

  return `${hour}.${minute}`;
}
