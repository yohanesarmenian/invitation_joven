import sharp from "sharp";
import { validationError } from "../auth/auth-errors.js";
import { MAX_VENUE_ASSET_BYTES } from "./event-content.validation.js";

export async function normalizeVenueUpload(source: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}) {
  const { buffer, filename, mimetype } = source;
  if (!buffer.length || buffer.length > MAX_VENUE_ASSET_BYTES)
    validationError();
  const ext = /\.([a-z]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === "pdf") {
    if (
      mimetype !== "application/pdf" ||
      !/^%PDF-1\.[0-9]/.test(buffer.subarray(0, 8).toString("ascii")) ||
      !/%%EOF\s*$/.test(buffer.subarray(-1024).toString("latin1"))
    )
      validationError();
    return { kind: "PDF", mimeType: "application/pdf", bytes: buffer } as const;
  }
  const expected =
    ext === "jpg" || ext === "jpeg"
      ? "jpeg"
      : ext === "png"
        ? "png"
        : ext === "webp"
          ? "webp"
          : null;
  if (!expected || mimetype !== `image/${expected}`) validationError();
  try {
    const image = sharp(buffer, {
      limitInputPixels: 20_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== expected ||
      (metadata.pages ?? 1) > 1 ||
      !metadata.width ||
      !metadata.height
    )
      validationError();
    const bytes = await image.rotate().png().toBuffer();
    if (bytes.length > MAX_VENUE_ASSET_BYTES) validationError();
    return { kind: "IMAGE", mimeType: "image/png", bytes } as const;
  } catch {
    validationError();
  }
}
