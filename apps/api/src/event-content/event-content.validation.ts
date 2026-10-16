import { validationError } from "../auth/auth-errors.js";
import type { EventVenueBodyDto } from "./event-content.dto.js";

export const MAX_VENUE_ASSET_BYTES = 5 * 1024 * 1024;
export const EMPTY_VENUE_CONTENT: EventVenueBodyDto = {
  parking: null,
  rundown: null,
};
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, fields: string[]) {
  return (
    Object.keys(v).length === fields.length &&
    fields.every((key) => Object.hasOwn(v, key))
  );
}
function text(v: unknown, length: number): v is string {
  return (
    typeof v === "string" &&
    v.length <= length &&
    !Array.from(v).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  );
}
function nullableId(v: unknown) {
  return v === null || (typeof v === "string" && UUID.test(v));
}
export function maps(v: unknown) {
  if (v === null) return true;
  if (typeof v !== "string" || v.length > 2048) return false;
  try {
    const url = new URL(v);
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
export function instant(v: unknown): v is string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      v,
    )
  )
    return false;
  const date = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === v.slice(0, 10) &&
    Number.isFinite(Date.parse(v)) &&
    !/[+-]14:(?!00)/.test(v)
  );
}
export function parseVenueBody(
  v: unknown,
  published = false,
): EventVenueBodyDto {
  if (!object(v) || !keys(v, ["parking", "rundown"])) validationError();
  if (Buffer.byteLength(JSON.stringify(v), "utf8") > 65_536) validationError();
  if (v.parking !== null) {
    const p = v.parking;
    if (
      !object(p) ||
      !keys(p, [
        "title",
        "instructions",
        "mapAssetId",
        "mapAlt",
        "pdfAssetId",
        "googleMapsUrl",
      ]) ||
      !text(p.title, 120) ||
      !Array.isArray(p.instructions) ||
      p.instructions.length > 12 ||
      !p.instructions.every((line) => text(line, 500)) ||
      !nullableId(p.mapAssetId) ||
      !nullableId(p.pdfAssetId) ||
      !text(p.mapAlt, 300) ||
      !maps(p.googleMapsUrl)
    )
      validationError();
    if (
      published &&
      (!p.title.trim() ||
        p.instructions.length === 0 ||
        p.instructions.some((line) => !String(line).trim()) ||
        (p.mapAssetId !== null && !p.mapAlt.trim()))
    )
      validationError();
  }
  if (v.rundown !== null) {
    const r = v.rundown;
    if (
      !object(r) ||
      !keys(r, ["title", "items"]) ||
      !text(r.title, 120) ||
      !Array.isArray(r.items) ||
      r.items.length > 30
    )
      validationError();
    let previous = -Infinity;
    for (const item of r.items) {
      if (
        !object(item) ||
        !keys(item, ["startsAt", "title", "description"]) ||
        !text(item.startsAt, 40) ||
        !text(item.title, 120) ||
        !text(item.description, 500)
      )
        validationError();
      if (item.startsAt !== "" && !instant(item.startsAt)) validationError();
      if (published) {
        if (
          !instant(item.startsAt) ||
          !item.title.trim() ||
          Date.parse(item.startsAt) < previous
        )
          validationError();
        previous = Date.parse(item.startsAt);
      }
    }
    if (published && (!r.title.trim() || r.items.length === 0))
      validationError();
  }
  if (published && v.parking === null && v.rundown === null) validationError();
  return v as unknown as EventVenueBodyDto;
}
export function parseVersion(v: unknown): number {
  if (
    !object(v) ||
    !Object.hasOwn(v, "expectedVersion") ||
    typeof v.expectedVersion !== "number" ||
    !Number.isSafeInteger(v.expectedVersion) ||
    v.expectedVersion < 0
  )
    validationError();
  return v.expectedVersion;
}
export function parseVersionOnly(v: unknown) {
  const version = parseVersion(v);
  if (!object(v) || !keys(v, ["expectedVersion"])) validationError();
  return version;
}
export function parseSave(v: unknown) {
  const version = parseVersion(v);
  if (!object(v) || !keys(v, ["expectedVersion", "content"])) validationError();
  return { version, content: parseVenueBody(v.content) };
}
export function assetIds(v: EventVenueBodyDto | null) {
  return [v?.parking?.mapAssetId, v?.parking?.pdfAssetId].filter(
    (id): id is string => typeof id === "string",
  );
}
