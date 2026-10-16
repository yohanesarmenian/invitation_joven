import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { assertDatabase, withClient } from "./database.mjs";

const keys = [
  "slug",
  "name",
  "displayOrder",
  "isActive",
  "startsAt",
  "endsAt",
  "venueName",
  "address",
  "googleMapsUrl",
];
export function parseCatalog(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Array.isArray(value.events) ||
    value.events.length < 1 ||
    value.events.length > 20
  )
    throw Error("Daily catalog must contain 1–20 events only.");
  const text = (input, limit, nullable = false) => {
    if (nullable && input === null) return null;
    if (
      typeof input !== "string" ||
      !input.trim() ||
      input !== input.trim() ||
      input.length > limit
    )
      throw Error("Daily catalog text is invalid.");
    return input;
  };
  const instant = (input) => {
    if (input === null) return null;
    if (
      typeof input !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
        input,
      )
    )
      throw Error("Daily catalog instants require an explicit ISO timezone.");
    const [year, month, day] = input.slice(0, 10).split("-").map(Number),
      calendar = new Date(Date.UTC(year, month - 1, day));
    const date = new Date(input);
    if (
      !Number.isFinite(date.getTime()) ||
      calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day
    )
      throw Error("Daily catalog calendar date is invalid.");
    return date.toISOString();
  };
  const events = value.events.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).length !== keys.length ||
      Object.keys(row).some((key) => !keys.includes(key))
    )
      throw Error("Daily catalog fields are invalid.");
    const slug = text(row.slug, 80),
      name = text(row.name, 200);
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      !Number.isInteger(row.displayOrder) ||
      row.displayOrder < 1 ||
      row.displayOrder > 1_000_000_000 ||
      typeof row.isActive !== "boolean"
    )
      throw Error("Daily catalog identity/order is invalid.");
    const startsAt = instant(row.startsAt),
      endsAt = instant(row.endsAt);
    if (endsAt && (!startsAt || Date.parse(endsAt) <= Date.parse(startsAt)))
      throw Error("Daily catalog end must follow its start.");
    const googleMapsUrl = text(row.googleMapsUrl, 2048, true);
    if (googleMapsUrl !== null) {
      let url;
      try {
        url = new URL(googleMapsUrl);
      } catch {
        throw Error("Daily catalog map URL is invalid.");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !(
          ((url.hostname === "www.google.com" ||
            url.hostname === "google.com") &&
            /^\/maps(?:\/|$)/.test(url.pathname)) ||
          (url.hostname === "maps.app.goo.gl" && url.pathname.length > 1)
        )
      )
        throw Error(
          "Daily catalog map URL must be an approved HTTPS Google Maps link.",
        );
    }
    return {
      slug,
      name,
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      startsAt,
      endsAt,
      venueName: text(row.venueName, 300, true),
      address: text(row.address, 1000, true),
      googleMapsUrl,
    };
  });
  if (
    new Set(events.map((row) => row.slug)).size !== events.length ||
    new Set(events.map((row) => row.displayOrder)).size !== events.length
  )
    throw Error("Daily catalog has duplicate slugs or display orders.");
  return events;
}
export async function initializeCatalog(config, file) {
  if ((await stat(file)).size > 64 * 1024)
    throw Error("Daily catalog exceeds 64 KiB.");
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw Error("Daily catalog JSON is invalid.");
  }
  const events = parseCatalog(value);
  await assertDatabase(config);
  return withClient(config.databaseUrl, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(8001320002)");
      const existing = (
        await client.query(
          'SELECT id,slug,name,display_order AS "displayOrder",is_active AS "isActive",starts_at AS "startsAt",ends_at AS "endsAt",venue_name AS "venueName",address,google_maps_url AS "googleMapsUrl" FROM events ORDER BY display_order',
        )
      ).rows;
      if (existing.length) {
        const equal =
          existing.length === events.length &&
          events.every((row) => {
            const current = existing.find((item) => item.slug === row.slug);
            return (
              current &&
              keys.every((key) => {
                const actual =
                  (key === "startsAt" || key === "endsAt") &&
                  current[key] !== null
                    ? current[key].toISOString()
                    : current[key];
                return actual === row[key];
              })
            );
          });
        if (!equal)
          throw Error(
            "Daily catalog conflicts with existing events; no update or partial import was attempted.",
          );
        await client.query("COMMIT");
        return { created: 0, unchanged: events.length };
      }
      for (const row of events)
        await client.query(
          "INSERT INTO events (id,slug,name,display_order,is_active,starts_at,ends_at,venue_name,address,google_maps_url,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())",
          [
            randomUUID(),
            row.slug,
            row.name,
            row.displayOrder,
            row.isActive,
            row.startsAt,
            row.endsAt,
            row.venueName,
            row.address,
            row.googleMapsUrl,
          ],
        );
      await client.query("COMMIT");
      return { created: events.length, unchanged: 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
