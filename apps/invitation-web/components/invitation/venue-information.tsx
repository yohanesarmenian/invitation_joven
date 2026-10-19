import Image from "next/image";
import {
  formatRundownInstant,
  type VenueContent,
} from "../../src/content/venue-content";

export function VenueInformation({ content }: { content: VenueContent }) {
  return (
    <>
      {content.parking.length > 0 ? (
        <section
          className="invitation-section venue-information"
          aria-labelledby="parking-title"
        >
          <h2 id="parking-title">Parking Guide</h2>
          {content.parking.map((guide) => (
            <section
              className="venue-content-card"
              key={guide.eventId}
              aria-label={`Parking for ${guide.eventName}`}
            >
              <p className="section-kicker">{guide.eventName}</p>
              <h3>{guide.title}</h3>
              <ul>
                {guide.instructions.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
              {guide.mapImage ? (
                <a
                  className="parking-map"
                  href={guide.mapImage.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open parking map for ${guide.eventName}`}
                >
                  <Image
                    src={guide.mapImage.src}
                    alt={guide.mapImage.alt}
                    fill
                    sizes="(min-width: 480px) 432px, calc(100vw - 48px)"
                    unoptimized
                  />
                </a>
              ) : null}
              <div className="venue-content-actions">
                {guide.guidePdf ? (
                  <a
                    className="map-link"
                    href={guide.guidePdf}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open parking guide (PDF)
                  </a>
                ) : null}
                {guide.googleMapsUrl ? (
                  <a
                    className="map-link"
                    href={guide.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Parking location in Google Maps
                  </a>
                ) : null}
              </div>
            </section>
          ))}
        </section>
      ) : null}
      {content.rundown.length > 0 ? (
        <section
          className="invitation-section venue-information"
          aria-labelledby="rundown-title"
        >
          <h2 id="rundown-title">Event Rundown</h2>
          {content.rundown.map((schedule) => (
            <section
              className="venue-content-card"
              key={schedule.eventId}
              aria-label={`Rundown for ${schedule.eventName}`}
            >
              <p className="section-kicker">{schedule.eventName}</p>
              <h3>{schedule.title}</h3>
              <ol className="rundown-list">
                {schedule.items.map((item, index) => {
                  const label = formatRundownInstant(item.startsAt);
                  return (
                    <li key={index}>
                      <time dateTime={item.startsAt}>
                        <span>{label.day}</span>
                        <strong>{label.time}</strong>
                      </time>
                      <div>
                        <h4>{item.title}</h4>
                        {item.description ? <p>{item.description}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </section>
      ) : null}
    </>
  );
}
