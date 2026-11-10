import Image from "next/image";
import type { ReactNode } from "react";
import type { PublicInvitationResponse } from "../../../../packages/api-client/src/index";
import { EventCalendar, EventCountdown } from "./event-enhancements";
import { InvitationGallery } from "./gallery";
import { VenueInformation } from "./venue-information";
import type { VenueContent } from "../../src/content/venue-content";
import { weddingMedia } from "../../src/presentation/wedding-media";
import { figmaAssets } from "../../src/presentation/figma-assets";

type PublicInvitation = PublicInvitationResponse["invitation"];
type PublicInvitationEvent = PublicInvitation["events"][number];
type DisplayInvitationEvent = Pick<
  PublicInvitationEvent,
  | "id"
  | "address"
  | "googleMapsUrl"
  | "name"
  | "startsAt"
  | "endsAt"
  | "venueName"
>;

export type PublicInvitationLongPageModel = {
  displayName: PublicInvitation["displayName"];
  events: DisplayInvitationEvent[];
  greetingName: PublicInvitation["greetingName"];
  rsvpDeadlineAt: PublicInvitation["rsvpDeadlineAt"];
};

// `sizes` values are derived from the current CSS column widths.
const BRIDE_PHOTO = weddingMedia.bride;
const GROOM_PHOTO = weddingMedia.groom;
const COUPLE_PHOTO_SIZES =
  "(min-width: 1040px) 350px, (min-width: 700px) 34vw, 70vw";

const decorativeAssets = {
  corner: {
    file: figmaAssets.long_WatercolorBloomingFlowers1,
    width: 798,
    height: 949,
  },
  cluster: {
    file: figmaAssets.long_WatercolorBloomingFlowersCopyCopy1,
    width: 405,
    height: 353,
  },
  leaves: { file: figmaAssets.long_Leaves1, width: 486, height: 384 },
  calendar: { file: figmaAssets.long_Calendar1, width: 533, height: 469 },
  ornament: { file: figmaAssets.long_Objects1, width: 910, height: 918 },
  brideBloom: {
    file: figmaAssets.long_ChatGptImageSep152026112225Am4,
    width: 1536,
    height: 1024,
  },
  dressBloom: {
    file: figmaAssets.long_WatercolorBloomingFlowersCopyCopy21,
    width: 300,
    height: 399,
  },
  lowerBloom: {
    file: figmaAssets.long_WatercolorBloomingFlowersCopy1,
    width: 800,
    height: 531,
  },
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
  const renderedSizes =
    asset === "brideBloom" ? "277px" : asset === "ornament" ? "178px" : sizes;

  return (
    <span className={`invitation-decoration ${className}`} aria-hidden="true">
      <Image
        src={source.file}
        alt=""
        width={source.width}
        height={source.height}
        sizes={renderedSizes}
        loading={asset === "corner" ? "eager" : "lazy"}
      />
    </span>
  );
}

// Owner-approved couple copy stays fixed. Event dates and the RSVP deadline
// are supplied by the public API.
const BRIDE = {
  name: "Angelina Desandra Adventa",
  nickname: "Venta",
  parents: ["Mr. Agus Witjaksono", "Mrs. Godeliva Yuniati"],
} as const;
const GROOM = {
  name: "Yohanes Armenian Putra",
  nickname: "Jo",
  parents: ["Mr. Eddy Frist Simamora", "Mrs. Entin Kartini"],
} as const;

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
  initialNow,
  venueContent,
}: {
  invitation: PublicInvitationLongPageModel;
  rsvpForm: ReactNode;
  guestMessageForm: ReactNode;
  initialNow: number;
  venueContent?: VenueContent;
}) {
  const guestName = invitation.greetingName ?? invitation.displayName;

  return (
    <main className="public-invitation-page" aria-labelledby="invitation-title">
      <article className="public-invitation-surface">
        <InvitationHeader guestName={guestName} />
        <CoupleSection />
        <WeddingDateSection events={invitation.events} />
        <EventCountdown events={invitation.events} initialNow={initialNow} />
        <EventsSection events={invitation.events} />
        {venueContent ? <VenueInformation content={venueContent} /> : null}
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
      <p className="section-kicker">Dear,</p>
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
    <section
      className="invitation-section couple-section"
      aria-labelledby="couple-title"
    >
      <h2 id="couple-title" className="couple-section-title">
        Bride and Groom
      </h2>
      {/* Family names and titles confirmed by the owner against Figma. */}
      <CoupleProfile
        role="Bride"
        name={BRIDE.name}
        nickname={BRIDE.nickname}
        parents={BRIDE.parents}
        mediaSide="left"
      />
      <CoupleProfile
        role="Groom"
        name={GROOM.name}
        nickname={GROOM.nickname}
        parents={GROOM.parents}
        mediaSide="right"
      />
      <Decoration
        asset="brideBloom"
        className="decoration-bride-bloom"
        sizes="78px"
      />
    </section>
  );
}

function CoupleProfile({
  role,
  name,
  nickname,
  parents,
  mediaSide,
}: {
  role: string;
  name: string;
  nickname: string;
  parents: readonly [string, string];
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
        loading="lazy"
      />
    </div>
  );
  const copy = (
    <div className="couple-copy">
      <p className="couple-role">The {role}</p>
      <h3 id={titleId}>
        {name} <span className="couple-nickname">({nickname})</span>
      </h3>
      <p className="couple-family-label">
        {role === "Bride" ? "Daughter of" : "Son of"}
      </p>
      <p className="couple-family-names">
        {parents[0]}
        <br />
        {role === "Bride" ? "& " : ""}
        {parents[1]}
      </p>
    </div>
  );

  return (
    <section
      className={`couple-profile couple-profile-${role.toLowerCase()}`}
      aria-labelledby={titleId}
      data-invitation-reveal
    >
      {mediaSide === "left" ? media : copy}
      {mediaSide === "left" ? copy : media}
    </section>
  );
}

function WeddingDateSection({ events }: { events: DisplayInvitationEvent[] }) {
  const dates = events.flatMap((event) =>
    event.startsAt && Number.isFinite(Date.parse(event.startsAt))
      ? [Date.parse(event.startsAt)]
      : [],
  );
  if (dates.length === 0) return null;
  const date = new Date(Math.min(...dates));
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "Asia/Jakarta",
  }).format(date);
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
  return (
    <section
      className="invitation-section wedding-date-section"
      aria-labelledby="wedding-date-title"
      data-invitation-reveal
    >
      <Decoration
        asset="leaves"
        className="decoration-groom-leaves"
        sizes="(min-width: 412px) 137px, 33vw"
      />
      <Decoration
        asset="calendar"
        className="decoration-calendar"
        sizes="59px"
      />
      <p className="section-kicker">Wedding Date</p>
      <div className="wedding-date-divider" aria-hidden="true" />
      <p className="wedding-date-day">{day}</p>
      <h2 id="wedding-date-title">{label}</h2>
      <div className="wedding-date-divider" aria-hidden="true" />
    </section>
  );
}

function EventsSection({ events }: { events: DisplayInvitationEvent[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section
      className="invitation-section events-section"
      aria-labelledby="events-title"
    >
      <h2 id="events-title">Wedding Events</h2>
      <div className="event-list">
        {events.map((event, index) => (
          <EventSection
            key={`${event.name}-${index}`}
            event={event}
            index={index}
          />
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
        <span className="event-number" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <EventIcon name={event.name} />
        {timeLabel ? (
          <>
            <time dateTime={event.startsAt ?? undefined}>{timeLabel}</time>
            <span className="event-time-zone">WIB</span>
          </>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
      <div className="event-detail-block">
        <h3 id={titleId}>{event.name}</h3>
        {event.startsAt ? (
          <p>
            {new Intl.DateTimeFormat("en-GB", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              timeZone: "Asia/Jakarta",
            }).format(new Date(event.startsAt))}
          </p>
        ) : null}
        {event.venueName ? (
          <p className="event-venue">{event.venueName}</p>
        ) : null}
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
          <EventCalendar event={event} />
        </div>
      </div>
      {index === 0 ? (
        <Decoration
          asset="ornament"
          className="decoration-event"
          sizes="78px"
        />
      ) : null}
    </section>
  );
}

// The public contract has no event-kind field. Recognize explicit names only;
// an unfamiliar name gets a neutral calendar, never an icon inferred by order.
function EventIcon({ name }: { name: string }) {
  const kind = /\b(reception|resepsi)\b/i.test(name)
    ? "celebration"
    : /\b(matrimony|ceremony|pemberkatan|akad)\b/i.test(name)
      ? "rings"
      : "calendar";
  return (
    <svg
      className="event-icon"
      data-event-icon={kind}
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "rings" ? (
        <>
          <circle cx="12" cy="19" r="8" />
          <circle cx="22" cy="19" r="7" />
          <path d="m9 6 3-3 3 3-3 5Z" />
        </>
      ) : kind === "celebration" ? (
        <>
          <path d="m5 4 10 3-3 10a5 5 0 0 1-9-3Zm5 15-2 8m-4-1 8 2m15-24-10 3 3 10a5 5 0 0 0 9-3Zm-5 15 2 8m4-1-8 2M5 11l8 2m6 0 8-2M16 1v3" />
        </>
      ) : (
        <>
          <rect x="4" y="7" width="24" height="22" rx="2" />
          <path d="M4 13h24M10 3v8m12-8v8M10 19h4m4 0h4m-12 5h4" />
        </>
      )}
    </svg>
  );
}

function DressCodeSection() {
  return (
    <section
      className="invitation-section dress-code-section"
      aria-labelledby="dress-code-title"
      data-invitation-reveal
    >
      <Decoration
        asset="dressBloom"
        className="decoration-dress-right"
        sizes="(min-width: 412px) 64px, 16vw"
      />
      <p className="section-kicker">Fine Attire</p>
      <h2 id="dress-code-title">Dress Code</h2>
      <p>Formal / Modern / National / Batik</p>
      <span className="figma-dress-palette" aria-hidden="true">
        <Image
          src={figmaAssets.long_DressCodeColors}
          alt=""
          width={307}
          height={47}
        />
      </span>
      <ul
        className="dress-swatch-list visually-hidden"
        aria-label="Dress code color references"
      >
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
    <section
      className="invitation-section rsvp-information-section"
      aria-labelledby="rsvp-title"
    >
      <Decoration
        asset="cluster"
        className="decoration-rsvp-left"
        sizes="(min-width: 412px) 126px, 31vw"
      />
      <div className="rsvp-section-copy">
        <h2 id="rsvp-title">RSVP &amp; Dietary Information</h2>
        <p className="figma-rsvp-intro">
          To help us make proper arrangements with our venue and caterers, we
          kindly ask that you confirm your attendance.
        </p>
        {deadlineLabel ? (
          <p className="deadline-copy">Kindly reply by {deadlineLabel}.</p>
        ) : null}
      </div>
      {children}
      <div className="rsvp-decoration-band" aria-hidden="true">
        <Decoration
          asset="lowerBloom"
          className="decoration-rsvp-main"
          sizes="(min-width: 412px) 128px, 31vw"
        />
        <Decoration
          asset="cluster"
          className="decoration-rsvp-small-a"
          sizes="47px"
        />
        <Decoration
          asset="cluster"
          className="decoration-rsvp-small-b"
          sizes="66px"
        />
      </div>
    </section>
  );
}

function GallerySection() {
  return (
    <section
      className="invitation-section gallery-section"
      aria-labelledby="gallery-title"
      data-invitation-reveal
    >
      <h2 id="gallery-title">Pre-wedding Gallery</h2>
      <InvitationGallery />
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
    <section
      className="invitation-section quote-section"
      data-invitation-reveal
    >
      <Image
        className="quote-photograph"
        src={weddingMedia.gallery[2].src}
        alt=""
        fill
        sizes="100vw"
        loading="lazy"
      />
      <blockquote>
        <p>Happiness is only real when shared</p>
        <cite>Christopher McCandless</cite>
      </blockquote>
      <Decoration
        asset="lowerBloom"
        className="decoration-lower"
        sizes="(min-width: 412px) 144px, 35vw"
      />
    </section>
  );
}

function GuestMessageSection({ children }: { children: ReactNode }) {
  return (
    <section
      className="invitation-section guest-message-section"
      aria-labelledby="message-title"
    >
      <h2 id="message-title">Leave a Message for the Bride &amp; Groom</h2>
      {children}
    </section>
  );
}

function ClosingSection() {
  return (
    <footer
      className="invitation-section invitation-footer"
      data-invitation-reveal
    >
      <Decoration
        asset="ornament"
        className="decoration-closing"
        sizes="78px"
      />
      <span className="closing-monogram" aria-hidden="true">
        Y<span>&amp;</span>A
      </span>
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
