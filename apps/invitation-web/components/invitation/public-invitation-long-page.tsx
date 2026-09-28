import Image from "next/image";
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

// 4B0 development fixtures. These local mock assets stand in for the
// owner-approved photographs and are expected to be replaced in 4B1.
// `sizes` values are derived from the current CSS column widths.
const MOCK_BRIDE = "/assets/mock/bride.svg";
const MOCK_GROOM = "/assets/mock/groom.svg";
const MOCK_COUPLE_SIZES =
  "(min-width: 480px) 198px, (max-width: 360px) 285px, 40vw";

const galleryFrames = [
  {
    src: "/assets/mock/gallery-01.svg",
    variant: "gallery-frame-large",
    sizes: "(min-width: 480px) 241px, 50vw",
  },
  {
    src: "/assets/mock/gallery-02.svg",
    variant: "gallery-frame-small",
    sizes: "(min-width: 480px) 178px, 37vw",
  },
  {
    src: "/assets/mock/gallery-03.svg",
    variant: "gallery-frame-medium",
    sizes: "(min-width: 480px) 178px, 37vw",
  },
  {
    src: "/assets/mock/gallery-04.svg",
    variant: "gallery-frame-tall",
    sizes: "(min-width: 480px) 241px, 50vw",
  },
];

// 4B2-A re-baseline. Owner-approved couple names and the wedding date are
// static invitation copy; the RSVP deadline is NOT hardcoded here because the
// public DTO already supplies it.
const BRIDE = {
  name: "Angelina Desandra Adventa",
  nickname: "Venta",
} as const;
const GROOM = {
  name: "Yohanes Armenian Putra",
  nickname: "Jo",
} as const;

const WEDDING_DAY = "Saturday";
const WEDDING_DATE = "09 January 2027";

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
        <McCandlessQuoteSection />
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
      {/* Family/parent copy is deferred: no owner-approved text exists in the
          repository yet, and titles must not be inferred from names. */}
      <CoupleProfile
        role="Bride"
        name={BRIDE.name}
        nickname={BRIDE.nickname}
        mediaSide="left"
      />
      <CoupleProfile
        role="Groom"
        name={GROOM.name}
        nickname={GROOM.nickname}
        mediaSide="right"
      />
    </section>
  );
}

function CoupleProfile({
  role,
  name,
  nickname,
  mediaSide,
}: {
  role: string;
  name: string;
  nickname: string;
  mediaSide: "left" | "right";
}) {
  const titleId = `${role.toLowerCase()}-title`;
  const media = (
    <div className="couple-media-slot" aria-hidden="true">
      <Image
        src={role === "Bride" ? MOCK_BRIDE : MOCK_GROOM}
        alt=""
        fill
        sizes={MOCK_COUPLE_SIZES}
        unoptimized
      />
    </div>
  );
  const copy = (
    <div className="couple-copy">
      <p className="section-kicker">{role}</p>
      <h3 id={titleId}>{name}</h3>
      <p className="couple-nickname">{nickname}</p>
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
      {/* Divider-delimited date block. Deliberately asset-free: the layout
          reserves the visual room a calendar ornament will occupy in 4C1. */}
      <div className="wedding-date-divider" aria-hidden="true" />
      <p className="wedding-date-day">{WEDDING_DAY}</p>
      <h2 id="wedding-date-title">{WEDDING_DATE}</h2>
      <div className="wedding-date-divider" aria-hidden="true" />
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
          {/* Non-interactive badge on purpose: the parking guide still has no
              destination, and a disabled control would imply otherwise. */}
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
  const deadlineLabel = formatDeadlineLabel(deadline);

  return (
    <section className="invitation-section rsvp-information-section" aria-labelledby="rsvp-title">
      <h2 id="rsvp-title">RSVP &amp; Dietary Information</h2>
      {/* Read-only on purpose: the Phase 4 contract has no RSVP mutation, so
          the future fields are described in text rather than rendered as
          controls that would look operable. */}
      <p>
        Attendance confirmation, events attended, companion details, and
        dietary preferences will be handled in a later step. This section is
        currently read-only.
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
        {galleryFrames.map((frame) => (
          <div
            key={frame.src}
            className={`gallery-frame ${frame.variant}`}
          >
            <Image
              src={frame.src}
              alt=""
              fill
              sizes={frame.sizes}
              unoptimized
            />
          </div>
        ))}
      </div>
      {/* Scripture belongs with the gallery in the updated baseline, not under
          an invented combined "scripture and words" heading. */}
      <div className="gallery-scripture">
        <blockquote>
          <p>We love because he first loved us.</p>
          <cite>1 John 4:19</cite>
        </blockquote>
      </div>
    </section>
  );
}

function McCandlessQuoteSection() {
  return (
    <section className="invitation-section quote-section">
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

const deadlineMonths = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Renders the deadline's ISO date portion as `25 December 2026`. String-only on
 * purpose: the deadline is displayed as the calendar date the API sent, without
 * introducing a second time zone rule next to the event-time one.
 */
function formatDeadlineLabel(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match === null) {
    return null;
  }

  const [, year, month, day] = match;
  const monthName = deadlineMonths[Number(month) - 1];

  if (
    year === undefined ||
    day === undefined ||
    monthName === undefined ||
    Number(month) < 1 ||
    Number(month) > 12
  ) {
    return null;
  }

  return `${Number(day)} ${monthName} ${year}`;
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
