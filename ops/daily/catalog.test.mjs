import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCatalog } from "./catalog.mjs";
const example = JSON.parse(
  await readFile(new URL("./catalog.example.json", import.meta.url), "utf8"),
);
function event(overrides = {}) {
  return { ...example.events[0], ...overrides };
}
test("unknown dates and venues remain explicit nulls", () => {
  const rows = parseCatalog(example);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].startsAt, null);
  assert.equal(rows[0].venueName, null);
});
test("ISO offset becomes the canonical UTC instant", () => {
  const rows = parseCatalog({
    events: [
      event({
        startsAt: "2027-01-02T17:00:00+07:00",
        endsAt: "2027-01-02T19:00:00+07:00",
      }),
    ],
  });
  assert.equal(rows[0].startsAt, "2027-01-02T10:00:00.000Z");
});
for (const overrides of [
  { extra: true },
  { slug: "Invalid Slug" },
  { displayOrder: 1.1 },
  { isActive: "true" },
  { startsAt: "2027-01-02T17:00:00" },
  { startsAt: "2027-02-31T10:00:00Z" },
  { endsAt: "2027-01-02T10:00:00Z" },
  { startsAt: "2027-01-02T10:00:00Z", endsAt: "2027-01-02T09:00:00Z" },
  { googleMapsUrl: "javascript:alert(1)" },
  { googleMapsUrl: "https://www.google.com.evil.test/maps/x" },
  { googleMapsUrl: "https://user:pass@www.google.com/maps/x" },
  { name: " padded " },
])
  test(`catalog invalid input case ${Object.keys(overrides).join("/")}: ${String(overrides.slug ?? overrides.startsAt ?? overrides.endsAt ?? Object.keys(overrides)[0])}`, () =>
    assert.throws(() => parseCatalog({ events: [event(overrides)] })));
test("duplicate slug/order are rejected before any transaction", () => {
  assert.throws(() => parseCatalog({ events: [event(), event()] }));
});
test("catalog structure/count is bounded", () => {
  assert.throws(() => parseCatalog({ events: [] }));
  assert.throws(() =>
    parseCatalog({
      events: Array.from({ length: 21 }, (_, i) =>
        event({ slug: `event-${i}`, displayOrder: i + 1 }),
      ),
    }),
  );
  assert.throws(() => parseCatalog({ events: [event()], sql: "not accepted" }));
});
