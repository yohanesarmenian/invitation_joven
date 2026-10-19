import "server-only";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseParkingDocument,
  parseRundownDocument,
  selectVenueContent,
  type VenueContent,
} from "../content/venue-content";

/** Fixed paths only; no guest-supplied filename or remote fetch. */
async function readDocument(filename: "parking.json" | "rundown.json") {
  try {
    const directory =
      process.env.VENUE_CONTENT_DIRECTORY ?? resolve(process.cwd(), "content");
    // Operator-selected directories are supplied at runtime. Default files are
    // included explicitly in next.config.ts, rather than tracing the workspace.
    const file = await open(
      /* turbopackIgnore: true */ resolve(directory, filename),
      "r",
    );
    try {
      const buffer = Buffer.alloc(65_537);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          total,
          buffer.length - total,
          total,
        );
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > 65_536) return null;
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, total),
        ),
      ) as unknown;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}
export async function readVenueDocuments() {
  const [parking, rundown] = await Promise.all([
    readDocument("parking.json"),
    readDocument("rundown.json"),
  ]);
  return {
    parking: parseParkingDocument(parking),
    rundown: parseRundownDocument(rundown),
  };
}

async function validAsset(src: string) {
  try {
    const file = await open(
      resolve(process.cwd(), "public", src.slice(1)),
      "r",
    );
    try {
      const size = (await file.stat()).size;
      if (size < 12 || size > 5 * 1024 * 1024) return false;
      const signature = Buffer.alloc(12);
      await file.read(signature, 0, 12, 0);
      if (src.endsWith(".pdf"))
        return signature.subarray(0, 5).toString("ascii") === "%PDF-";
      if (src.endsWith(".png"))
        return signature
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (/\.jpe?g$/.test(src))
        return (
          signature[0] === 255 && signature[1] === 216 && signature[2] === 255
        );
      return (
        signature.subarray(0, 4).toString("ascii") === "RIFF" &&
        signature.subarray(8, 12).toString("ascii") === "WEBP"
      );
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}
export async function verifyVenueAssets(
  content: VenueContent,
): Promise<VenueContent> {
  const verified = await Promise.all(
    content.parking.map(async (guide) => {
      const sources = [guide.mapImage?.src, guide.guidePdf].filter(
        (src): src is string => typeof src === "string",
      );
      return (await Promise.all(sources.map(validAsset))).every(Boolean)
        ? guide
        : null;
    }),
  );
  return {
    parking: verified.filter((guide) => guide !== null),
    rundown: content.rundown,
  };
}
export async function loadPublishedVenueContent(
  events: readonly { id: string; name: string }[],
) {
  return verifyVenueAssets(
    selectVenueContent(await readVenueDocuments(), events),
  );
}
