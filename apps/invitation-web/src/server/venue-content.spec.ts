import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPublishedVenueContent, readVenueDocuments } from "./venue-content";

const event = { id: "22222222-2222-4222-8222-222222222222", name: "Reception" };
const guide = {
  eventId: event.id,
  title: "Parking",
  instructions: ["Use the signed entrance."],
  mapImage: null as null | { src: string; alt: string },
  guidePdf: null as string | null,
  googleMapsUrl: null,
};
const parking = () => ({
  schemaVersion: 1,
  status: "published",
  guides: [{ ...guide }],
});
const rundown = () => ({
  schemaVersion: 1,
  status: "published",
  timeZone: "Asia/Jakarta",
  schedules: [
    {
      eventId: event.id,
      title: "Rundown",
      items: [
        {
          startsAt: "2027-01-09T11:30:00+07:00",
          title: "Arrival",
          description: "",
        },
      ],
    },
  ],
});
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "invitation-venue-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("VENUE_CONTENT_DIRECTORY", join(root, "content"));
  await mkdir(join(root, "content"));
  await mkdir(join(root, "public/assets/venue"), { recursive: true });
  await writeFile(
    join(root, "content/parking.json"),
    JSON.stringify(parking()),
  );
  await writeFile(
    join(root, "content/rundown.json"),
    JSON.stringify(rundown()),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
describe("server venue file loading", () => {
  it("loads only published eligible projections without requiring a database", async () => {
    const content = await loadPublishedVenueContent([event]);
    expect(content.parking).toHaveLength(1);
    expect(content.rundown).toHaveLength(1);
    expect(await loadPublishedVenueContent([])).toEqual({
      parking: [],
      rundown: [],
    });
  });
  it("does not use preview opt-in to expose draft content on guest routes", async () => {
    vi.stubEnv("VENUE_CONTENT_PREVIEW", "1");
    await writeFile(
      join(root, "content/parking.json"),
      JSON.stringify({ ...parking(), status: "draft" }),
    );
    expect((await loadPublishedVenueContent([event])).parking).toEqual([]);
  });
  it.each(["missing", "invalid-json", "oversized", "invalid-utf8"])(
    "fails closed for %s parking but keeps independently valid rundown",
    async (mode) => {
      const path = join(root, "content/parking.json");
      if (mode === "missing") await rm(path);
      else if (mode === "invalid-json") await writeFile(path, "{");
      else if (mode === "oversized") await writeFile(path, " ".repeat(65_537));
      else
        await writeFile(
          path,
          Buffer.concat([
            Buffer.from(
              JSON.stringify(parking()).replace("Parking", "BAD_BYTE"),
            ),
            Buffer.from([255]),
          ]),
        );
      expect((await readVenueDocuments()).parking).toBeNull();
      const content = await loadPublishedVenueContent([event]);
      expect(content.parking).toEqual([]);
      expect(content.rundown).toHaveLength(1);
    },
  );
  it("hides the guide when a referenced asset is missing or its actual signature is wrong", async () => {
    const p = parking();
    p.guides[0]!.mapImage = { src: "/assets/venue/map.png", alt: "Entrance" };
    await writeFile(join(root, "content/parking.json"), JSON.stringify(p));
    expect((await loadPublishedVenueContent([event])).parking).toEqual([]);
    await writeFile(
      join(root, "public/assets/venue/map.png"),
      "<html>not an image</html>",
    );
    expect((await loadPublishedVenueContent([event])).parking).toEqual([]);
  });
  it("accepts matching image/PDF headers and refuses assets above 5 MiB", async () => {
    const p = parking();
    p.guides[0]!.mapImage = { src: "/assets/venue/map.png", alt: "Entrance" };
    p.guides[0]!.guidePdf = "/assets/venue/guide.pdf";
    await writeFile(join(root, "content/parking.json"), JSON.stringify(p));
    await writeFile(
      join(root, "public/assets/venue/map.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhE8AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await writeFile(
      join(root, "public/assets/venue/guide.pdf"),
      "%PDF-1.4\n%%EOF\n",
    );
    expect((await loadPublishedVenueContent([event])).parking).toHaveLength(1);
    await writeFile(
      join(root, "public/assets/venue/guide.pdf"),
      Buffer.alloc(5 * 1024 * 1024 + 1),
    );
    expect((await loadPublishedVenueContent([event])).parking).toEqual([]);
  });
});
