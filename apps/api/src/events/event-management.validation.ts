import { validationError } from "../auth/auth-errors.js";
import { instant, maps } from "../event-content/event-content.validation.js";
import type { EventFieldsDto } from "./event-management.dto.js";

const fields = [
  "slug",
  "name",
  "description",
  "startsAt",
  "endsAt",
  "venueName",
  "address",
  "googleMapsUrl",
  "displayOrder",
  "isActive",
];
function text(v: unknown, max: number, nullable = false): v is string | null {
  return (
    (nullable && v === null) ||
    (typeof v === "string" &&
      v.trim().length > 0 &&
      v.length <= max &&
      !Array.from(v).some((c) => {
        const n = c.charCodeAt(0);
        return (n < 32 && ![9, 10, 13].includes(n)) || n === 127;
      }))
  );
}
export function parseEvent(
  body: unknown,
  update = false,
): { fields: EventFieldsDto; expectedVersion?: number } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    validationError();
  const b = body as Record<string, unknown>;
  const keys = update ? [...fields, "expectedVersion"] : fields;
  if (
    Object.keys(b).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(b, k))
  )
    validationError();
  if (
    !text(b.slug, 80) ||
    typeof b.slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.slug) ||
    !text(b.name, 200) ||
    !text(b.description, 2000, true) ||
    !text(b.venueName, 300, true) ||
    !text(b.address, 2000, true) ||
    !maps(b.googleMapsUrl) ||
    !(b.startsAt === null || instant(b.startsAt)) ||
    !(b.endsAt === null || instant(b.endsAt)) ||
    !Number.isInteger(b.displayOrder) ||
    Number(b.displayOrder) < 0 ||
    Number(b.displayOrder) > 2147483647 ||
    typeof b.isActive !== "boolean"
  )
    validationError();
  if (
    b.endsAt !== null &&
    (b.startsAt === null ||
      Date.parse(String(b.endsAt)) <= Date.parse(String(b.startsAt)))
  )
    validationError();
  if (
    update &&
    (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 1)
  )
    validationError();
  return {
    fields: Object.fromEntries(
      fields.map((k) => [k, b[k]]),
    ) as unknown as EventFieldsDto,
    ...(update ? { expectedVersion: Number(b.expectedVersion) } : {}),
  };
}
