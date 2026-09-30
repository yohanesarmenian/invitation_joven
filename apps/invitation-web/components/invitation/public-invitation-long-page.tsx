import Image from "next/image";
import type { ReactNode } from "react";
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

// `sizes` values are derived from the current CSS column widths.
const BRIDE_PHOTO = "/assets/photos/bride.png";
const GROOM_PHOTO = "/assets/photos/groom.png";
const COUPLE_PHOTO_SIZES =
  "(min-width: 480px) 215px, (max-width: 360px) calc(100vw - 38px), 43vw";

const galleryFrames = [
  {
    src: "/assets/photos/gallery-01.png",
    variant: "gallery-frame-large",
    sizes: "(min-width: 480px) 241px, 50vw",
  },
  {
    src: "/assets/photos/gallery-02.png",
    variant: "gallery-frame-small",
    sizes: "(min-width: 480px) 178px, 37vw",
  },
  {
    src: "/assets/photos/gallery-03.png",
    variant: "gallery-frame-medium",
    sizes: "(min-width: 480px) 178px, 37vw",
  },
  {
    src: "/assets/photos/gallery-04.png",
    variant: "gallery-frame-tall",
    sizes: "(min-width: 480px) 241px, 50vw",
  },
];

const decorativeAssets = {
  corner: { file: "hydrangea-corner.png", width: 166, height: 171 },
  cluster: { file: "hydrangea-cluster.png", width: 616, height: 524 },
  leaves: { file: "groom-leaves.svg", width: 138, height: 138 },
  calendar: { file: "calendar.svg", width: 59, height: 52 },
  rings: { file: "rings.svg", width: 88, height: 58 },
  ornament: { file: "small-ornament.svg", width: 78, height: 37 },
} as const;

function Decoration({
  asset,
  className,
  sizes,
}: {
  asset: keyof typeof decorativeAssets;
  className: string;
  sizes: string;
}) {
  const source = decorativeAssets[asset];

  return (
    <span className={`invitation-decoration ${className}`} aria-hidden="true">
      <Image
        src={`/assets/decorative/${source.file}`}
        alt=""
        width={source.width}
        height={source.height}
        sizes={sizes}
      />
    </span>
  );
}

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
  rsvpForm,
  guestMessageForm,
}: {
  invitation: PublicInvitationLongPageModel;
  rsvpForm: ReactNode;
  guestMessageForm: ReactNode;
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
        <RsvpInformationSection deadline={invitation.rsvpDeadlineAt}>
          {rsvpForm}
        </RsvpInformationSection>
        <GallerySection />
        <McCandlessQuoteSection />
        <GuestMessageSection>{guestMessageForm}</GuestMessageSection>
        <ClosingSection />
      </article>
    </main>
  );
}

function InvitationHeader({ guestName }: { guestName: string }) {
  return (
    <header className="invitation-section invitation-header">
      <Decoration
        asset="corner"
        className="decoration-top"
        sizes="(min-width: 412px) 140px, 34vw"
      />
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
        src={role === "Bride" ? BRIDE_PHOTO : GROOM_PHOTO}
        alt=""
        fill
        sizes={COUPLE_PHOTO_SIZES}
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
      <Decoration
        asset="leaves"
        className="decoration-groom-leaves"
        sizes="(min-width: 412px) 137px, 33vw"
      />
      <Decoration asset="calendar" className="decoration-calendar" sizes="59px" />
      <p className="section-kicker">Wedding Date</p>
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
        <Decoration
          asset="rings"
          className={
            index === 0
              ? "decoration-rings"
              : "decoration-rings decoration-rings-small"
          }
          sizes={index === 0 ? "88px" : "68px"}
        />
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
      {index === 0 ? (
        <Decoration asset="ornament" className="decoration-event" sizes="78px" />
      ) : null}
    </section>
  );
}

function DressCodeSection() {
  return (
    <section className="invitation-section dress-code-section" aria-labelledby="dress-code-title">
      <Decoration
        asset="corner"
        className="decoration-dress-right"
        sizes="(min-width: 412px) 64px, 16vw"
      />
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

function RsvpInformationSection({
  deadline,
  children,
}: {
  deadline: string | null;
  children: ReactNode;
}) {
  const deadlineLabel = formatDeadlineLabel(deadline);

  return (
    <section className="invitation-section rsvp-information-section" aria-labelledby="rsvp-title">
      <Decoration
        asset="cluster"
        className="decoration-rsvp-left"
        sizes="(min-width: 412px) 126px, 31vw"
      />
      <h2 id="rsvp-title">RSVP &amp; Dietary Information</h2>
      {deadlineLabel ? <p className="deadline-copy">Kindly reply by {deadlineLabel}.</p> : null}
      {children}
      <div className="rsvp-decoration-band" aria-hidden="true">
        <Decoration
          asset="cluster"
          className="decoration-rsvp-main"
          sizes="(min-width: 412px) 128px, 31vw"
        />
        <Decoration
          asset="corner"
          className="decoration-rsvp-small-a"
          sizes="47px"
        />
        <Decoration
          asset="corner"
          className="decoration-rsvp-small-b"
          sizes="66px"
        />
      </div>
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
            />
          </div>
        ))}
      </div>
      {/* Scripture belongs with the gallery in the updated baseline, not under
          an invented combined "scripture and words" heading. */}
      <div className="gallery-scripture">
        <Decoration
          asset="corner"
          className="decoration-gallery"
          sizes="(min-width: 412px) 102px, 25vw"
        />
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
      <Decoration
        asset="cluster"
        className="decoration-lower"
        sizes="(min-width: 412px) 144px, 35vw"
      />
    </section>
  );
}

function GuestMessageSection({ children }: { children: ReactNode }) {
  return (
    <section className="invitation-section guest-message-section" aria-labelledby="message-title">
      <h2 id="message-title">Leave a Message for the Bride &amp; Groom</h2>
      {children}
    </section>
  );
}

function ClosingSection() {
  return (
    <footer className="invitation-section invitation-footer">
      <Decoration asset="ornament" className="decoration-closing" sizes="78px" />
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
