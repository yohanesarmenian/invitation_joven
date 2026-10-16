import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VenueInformation } from "../../../components/invitation/venue-information";
import {
  selectVenueContent,
  venuePreviewEnabled,
} from "../../../src/content/venue-content";
import {
  readVenueDocuments,
  verifyVenueAssets,
} from "../../../src/server/venue-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Venue content preview",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
const PREVIEW_EVENT = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Reception preview (synthetic)",
};

export default async function VenuePreview({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  if (!venuePreviewEnabled(process.env)) notFound();
  const documents = await readVenueDocuments();
  const ids = new Set([
    PREVIEW_EVENT.id,
    ...(documents.parking?.guides.flatMap((guide) =>
      guide.eventId ? [guide.eventId] : [],
    ) ?? []),
    ...(documents.rundown?.schedules.flatMap((schedule) =>
      schedule.eventId ? [schedule.eventId] : [],
    ) ?? []),
  ]);
  const events =
    (await searchParams).event === "none"
      ? []
      : [...ids].map((id, index) => ({
          id,
          name:
            id === PREVIEW_EVENT.id
              ? PREVIEW_EVENT.name
              : `Event ${index} preview (synthetic)`,
        }));
  const selected = selectVenueContent(documents, events, PREVIEW_EVENT.id);
  const content = await verifyVenueAssets(selected);
  return (
    <main className="public-invitation-page">
      <article className="public-invitation-surface">
        <header className="invitation-section venue-preview-notice">
          <h1>Draft venue preview</h1>
          <p>
            Sample content only. Times and directions are not final. This
            preview uses a synthetic event and no guest data.
          </p>
          <nav aria-label="Preview eligibility">
            <a href="/dev/venue-preview">Reception preview</a>
            <a href="/dev/venue-preview?event=none">No eligible event</a>
          </nav>
          {!documents.parking ? (
            <p role="status">
              Parking file is missing or invalid. Check content/parking.json.
            </p>
          ) : null}
          {!documents.rundown ? (
            <p role="status">
              Rundown file is missing or invalid. Check content/rundown.json.
            </p>
          ) : null}
          {selected.parking.length > content.parking.length ? (
            <p role="status">
              A parking asset is missing, too large, or has an invalid file
              signature.
            </p>
          ) : null}
        </header>
        <VenueInformation content={content} />
        {content.parking.length === 0 && content.rundown.length === 0 ? (
          <p className="invitation-section" role="status">
            No venue content for the selected event.
          </p>
        ) : null}
      </article>
    </main>
  );
}
