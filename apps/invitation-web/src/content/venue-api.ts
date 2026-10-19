import type { ApiComponents } from "../../../../packages/api-client/src/index";
import { isRundownInstant, type VenueContent } from "./venue-content";
export type VenueBody = ApiComponents["schemas"]["EventVenueBodyDto"];
export type PublicVenueResponse =
  ApiComponents["schemas"]["PublicEventContentDto"];
export type AdminVenueState = ApiComponents["schemas"]["AdminEventContentDto"];
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const nullableId = (v: unknown) => v === null || uuid(v);
export function isVenueBody(v: unknown): v is VenueBody {
  if (!object(v)) return false;
  const p = v.parking,
    r = v.rundown;
  return (
    (p === null ||
      (object(p) &&
        typeof p.title === "string" &&
        Array.isArray(p.instructions) &&
        p.instructions.every((line) => typeof line === "string") &&
        nullableId(p.mapAssetId) &&
        nullableId(p.pdfAssetId) &&
        typeof p.mapAlt === "string" &&
        (p.googleMapsUrl === null || typeof p.googleMapsUrl === "string"))) &&
    (r === null ||
      (object(r) &&
        typeof r.title === "string" &&
        Array.isArray(r.items) &&
        r.items.every(
          (item) =>
            object(item) &&
            typeof item.startsAt === "string" &&
            typeof item.title === "string" &&
            typeof item.description === "string",
        )))
  );
}
export function isPublicVenueResponse(v: unknown): v is PublicVenueResponse {
  return (
    object(v) &&
    Array.isArray(v.items) &&
    v.items.every(
      (item) =>
        object(item) &&
        uuid(item.eventId) &&
        typeof item.eventName === "string" &&
        isVenueBody(item.content),
    )
  );
}
export function isAdminVenueState(v: unknown): v is AdminVenueState {
  return (
    object(v) &&
    uuid(v.eventId) &&
    typeof v.eventName === "string" &&
    typeof v.version === "number" &&
    Number.isSafeInteger(v.version) &&
    v.version >= 0 &&
    isVenueBody(v.draft) &&
    (v.published === null || isVenueBody(v.published)) &&
    (v.publishedAt === null ||
      (typeof v.publishedAt === "string" &&
        Number.isFinite(Date.parse(v.publishedAt)))) &&
    Array.isArray(v.assets) &&
    v.assets.every(
      (a) =>
        object(a) &&
        uuid(a.id) &&
        ((a.kind === "IMAGE" && a.mimeType === "image/png") ||
          (a.kind === "PDF" && a.mimeType === "application/pdf")) &&
        typeof a.byteSize === "number" &&
        Number.isSafeInteger(a.byteSize) &&
        a.byteSize > 0 &&
        a.byteSize <= 5 * 1024 * 1024 &&
        typeof a.usedByDraft === "boolean" &&
        typeof a.usedByPublished === "boolean",
    )
  );
}
export function venueFromApi(
  items: PublicVenueResponse["items"],
  assetUrl: (eventId: string, assetId: string) => string,
): VenueContent {
  return {
    parking: items.flatMap(({ eventId, eventName, content }) =>
      content.parking
        ? [
            {
              eventId,
              eventName,
              title: content.parking.title,
              instructions: content.parking.instructions,
              mapImage: content.parking.mapAssetId
                ? {
                    src: assetUrl(eventId, content.parking.mapAssetId),
                    alt: content.parking.mapAlt,
                  }
                : null,
              guidePdf: content.parking.pdfAssetId
                ? assetUrl(eventId, content.parking.pdfAssetId)
                : null,
              googleMapsUrl: content.parking.googleMapsUrl,
            },
          ]
        : [],
    ),
    rundown: items.flatMap(({ eventId, eventName, content }) =>
      content.rundown
        ? [
            {
              eventId,
              eventName,
              title: content.rundown.title,
              items: content.rundown.items.filter((item) =>
                isRundownInstant(item.startsAt),
              ),
            },
          ]
        : [],
    ),
  };
}
