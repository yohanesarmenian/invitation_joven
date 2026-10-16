type Status = "draft" | "published";
type Image = { src: string; alt: string };
export type ParkingGuide = {
  eventId: string | null;
  title: string;
  instructions: string[];
  mapImage: Image | null;
  guidePdf: string | null;
  googleMapsUrl: string | null;
};
export type Schedule = {
  eventId: string | null;
  title: string;
  items: { startsAt: string; title: string; description: string }[];
};
export type ParkingDocument = {
  schemaVersion: 1;
  status: Status;
  guides: ParkingGuide[];
};
export type RundownDocument = {
  schemaVersion: 1;
  status: Status;
  timeZone: "Asia/Jakarta";
  schedules: Schedule[];
};
export type VenueDocuments = {
  parking: ParkingDocument | null;
  rundown: RundownDocument | null;
};
export type VenueContent = {
  parking: (ParkingGuide & { eventId: string; eventName: string })[];
  rundown: (Schedule & { eventId: string; eventName: string })[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, names: string[]) {
  return (
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}
function text(value: unknown, maximum: number, empty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (empty || value.trim().length > 0) &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  );
}
function eventId(value: unknown, status: unknown) {
  return (
    (value === null && status === "draft") ||
    (typeof value === "string" && UUID.test(value))
  );
}
export function isVenueAsset(
  value: unknown,
  kind: "image" | "pdf",
): value is string {
  if (typeof value !== "string") return false;
  return kind === "image"
    ? /^\/assets\/venue\/[a-z0-9][a-z0-9-]*\.(png|jpg|jpeg|webp)$/.test(value)
    : /^\/assets\/venue\/[a-z0-9][a-z0-9-]*\.pdf$/.test(value);
}
function mapsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (((url.hostname === "www.google.com" || url.hostname === "google.com") &&
        /^\/maps(?:\/|$)/.test(url.pathname)) ||
        (url.hostname === "maps.app.goo.gl" && url.pathname.length > 1))
    );
  } catch {
    return false;
  }
}
function uniqueEvents(values: { eventId: string | null }[]) {
  const ids = values.flatMap((value) =>
    value.eventId === null ? [] : [value.eventId.toLowerCase()],
  );
  return new Set(ids).size === ids.length;
}
export function parseParkingDocument(value: unknown): ParkingDocument | null {
  if (
    !record(value) ||
    !keys(value, ["schemaVersion", "status", "guides"]) ||
    value.schemaVersion !== 1 ||
    (value.status !== "draft" && value.status !== "published") ||
    !Array.isArray(value.guides) ||
    value.guides.length > 20
  )
    return null;
  for (const guide of value.guides) {
    if (
      !record(guide) ||
      !keys(guide, [
        "eventId",
        "title",
        "instructions",
        "mapImage",
        "guidePdf",
        "googleMapsUrl",
      ]) ||
      !eventId(guide.eventId, value.status) ||
      !text(guide.title, 120) ||
      !Array.isArray(guide.instructions) ||
      guide.instructions.length < 1 ||
      guide.instructions.length > 12 ||
      !guide.instructions.every((line) => text(line, 500))
    )
      return null;
    if (
      guide.mapImage !== null &&
      (!record(guide.mapImage) ||
        !keys(guide.mapImage, ["src", "alt"]) ||
        !isVenueAsset(guide.mapImage.src, "image") ||
        !text(guide.mapImage.alt, 300))
    )
      return null;
    if (guide.guidePdf !== null && !isVenueAsset(guide.guidePdf, "pdf"))
      return null;
    if (guide.googleMapsUrl !== null && !mapsUrl(guide.googleMapsUrl))
      return null;
  }
  const parsed = value as ParkingDocument;
  return uniqueEvents(parsed.guides) ? parsed : null;
}
export function isRundownInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      value,
    )
  )
    return false;
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === datePart &&
    Number.isFinite(Date.parse(value)) &&
    !/[+-]14:(?!00)/.test(value)
  );
}
export function parseRundownDocument(value: unknown): RundownDocument | null {
  if (
    !record(value) ||
    !keys(value, ["schemaVersion", "status", "timeZone", "schedules"]) ||
    value.schemaVersion !== 1 ||
    (value.status !== "draft" && value.status !== "published") ||
    value.timeZone !== "Asia/Jakarta" ||
    !Array.isArray(value.schedules) ||
    value.schedules.length > 20
  )
    return null;
  for (const schedule of value.schedules) {
    if (
      !record(schedule) ||
      !keys(schedule, ["eventId", "title", "items"]) ||
      !eventId(schedule.eventId, value.status) ||
      !text(schedule.title, 120) ||
      !Array.isArray(schedule.items) ||
      schedule.items.length < 1 ||
      schedule.items.length > 30
    )
      return null;
    let previous = -Infinity;
    for (const item of schedule.items) {
      if (
        !record(item) ||
        !keys(item, ["startsAt", "title", "description"]) ||
        !isRundownInstant(item.startsAt) ||
        !text(item.title, 120) ||
        !text(item.description, 500, true)
      )
        return null;
      const instant = Date.parse(item.startsAt);
      if (instant < previous) return null;
      previous = instant;
    }
  }
  const parsed = value as RundownDocument;
  return uniqueEvents(parsed.schedules) ? parsed : null;
}

/** Draft binding is exclusively for the synthetic development preview. */
export function selectVenueContent(
  documents: VenueDocuments,
  events: readonly { id: string; name: string }[],
  previewEventId?: string,
): VenueContent {
  const eligible = new Map(
    events.map((event) => [event.id.toLowerCase(), event]),
  );
  function select<T extends { eventId: string | null }>(
    document: { status: Status } | null,
    entries: T[],
  ) {
    if (
      !document ||
      (document.status !== "published" && previewEventId === undefined)
    )
      return [];
    return entries.flatMap((entry) => {
      const id =
        entry.eventId ??
        (document.status === "draft" ? previewEventId : undefined);
      const event = id ? eligible.get(id.toLowerCase()) : undefined;
      return event
        ? [{ ...entry, eventId: event.id, eventName: event.name }]
        : [];
    });
  }
  return {
    parking: select(documents.parking, documents.parking?.guides ?? []),
    rundown: select(documents.rundown, documents.rundown?.schedules ?? []),
  };
}

export function venuePreviewEnabled(env: {
  NODE_ENV?: string;
  VENUE_CONTENT_PREVIEW?: string;
}) {
  return env.NODE_ENV === "development" && env.VENUE_CONTENT_PREVIEW === "1";
}
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
export function formatRundownInstant(value: string) {
  const date = new Date(value);
  return {
    day: dayFormatter.format(date),
    time: `${timeFormatter.format(date).replace(":", ".")} WIB`,
  };
}
