// Build original-photo derivatives for this review artifact only. Never overwrites originals.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, "../../..");
const requireFromApi = createRequire(
  path.join(project, "apps/api/package.json"),
);
const sharp = requireFromApi("sharp");
const specs = [
  {
    source: "Cover.JPG",
    output: "cover.webp",
    width: 1400,
    height: 2100,
    slots: ["opening hero", "desktop identity", "gallery 4"],
    focalPoint: { x: 50, y: 58 },
    visual:
      "Couple holding hands in the garden, portrait after EXIF orientation",
  },
  {
    source: "Venta.JPG",
    output: "venta.webp",
    width: 1000,
    height: 1500,
    slots: ["bride portrait"],
    focalPoint: { x: 45, y: 45 },
    visual: "Venta in blue and white clothing by an archway",
  },
  {
    source: "JJo.JPG",
    output: "jo.webp",
    width: 1000,
    height: 1500,
    slots: ["groom portrait"],
    focalPoint: { x: 50, y: 42 },
    visual: "Jo standing under an archway",
  },
  {
    source: "Pic1.JPG",
    output: "pic-01.webp",
    width: 1200,
    height: 1800,
    slots: ["gallery 3 portrait"],
    focalPoint: { x: 50, y: 52 },
    visual: "Couple walking together under an archway",
  },
  {
    source: "Pic2.JPG",
    output: "pic-02.webp",
    width: 1400,
    height: 1000,
    slots: ["gallery 1 portrait thumbnail", "gallery 1 uncropped lightbox"],
    focalPoint: { x: 50, y: 50 },
    visual: "Couple with cats in the garden; preserve landscape composition",
  },
  {
    source: "Pic3.JPG",
    output: "pic-03.webp",
    width: 1200,
    height: 1800,
    slots: ["gallery 2 portrait"],
    focalPoint: { x: 52, y: 65 },
    visual: "Couple dancing in the garden",
  },
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
await fs.mkdir(path.join(root, "media"), { recursive: true });
const records = [];
for (const spec of specs) {
  const sourcePath = path.join(project, "gambar-edit", spec.source);
  const original = await fs.readFile(sourcePath);
  const metadata = await sharp(original).metadata();
  const output = await sharp(original)
    .rotate()
    .resize({
      width: spec.width,
      height: spec.height,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 86 })
    .toBuffer();
  await fs.writeFile(path.join(root, "media", spec.output), output);
  const derived = await sharp(output).metadata();
  let thumbnail;
  if (spec.output === "pic-02.webp") {
    // Crop from the full-resolution original, not an already downsized image.
    // Matching the portrait slot prevents object-fit from enlarging a short
    // landscape rendition selected by responsive image width alone.
    const thumb = await sharp(original)
      .rotate()
      .resize({
        width: 900,
        height: 1200,
        fit: "cover",
        position: "centre",
        withoutEnlargement: true,
      })
      .webp({ quality: 86 })
      .toBuffer();
    await fs.writeFile(path.join(root, "media/gallery-cats-thumb.webp"), thumb);
    thumbnail = {
      path: "docs/design/jo-venta/media/gallery-cats-thumb.webp",
      width: 900,
      height: 1200,
      bytes: thumb.length,
      sha256: digest(thumb),
      crop: "3:4 center crop from original after EXIF normalization; both people retained; uncropped image remains available in lightbox",
    };
  }
  if (digest(await fs.readFile(sourcePath)) !== digest(original))
    throw new Error("Original changed during preparation");
  records.push({
    ...spec,
    sourcePath: `gambar-edit/${spec.source}`,
    source: {
      width: metadata.width,
      height: metadata.height,
      exifOrientation: metadata.orientation ?? null,
      bytes: original.length,
      sha256: digest(original),
    },
    normalizedDimensions: [derived.width, derived.height],
    derivative: {
      path: `docs/design/jo-venta/media/${spec.output}`,
      bytes: output.length,
      sha256: digest(output),
      format: "webp",
      exifRemoved: !derived.exif,
    },
    ...(thumbnail ? { thumbnail } : {}),
    provenance:
      "Owner supplied location in this chat on 2026-10-15; visually inspected before slot assignment",
    status:
      "Mapped after owner supplied photos; active application follows owner-requested Figma layout",
    transform:
      "EXIF orientation normalization, bounded resize, WebP encoding; no retouch, compositing, color treatment or face alteration",
  });
}
const manifest = {
  version: 1,
  date: "2026-10-15",
  scope:
    "Owner photo source mapping and derivatives for original Figma-layout application and prototype; legacy assets retained",
  selection:
    "Six supplied photos fill hero, profiles and four gallery positions. Cover is intentionally reused as gallery 4; no fourth distinct gallery photo is invented.",
  assets: records,
  preservedApplicationHero: "/assets/hero/opened-hero.png",
  notes: [
    "Focal points are review candidates and must be checked against the rendered geometry",
    "Source EXIF can rotate displayed dimensions; original pixel headers are not displayed dimensions",
    "Photo export screenshots are not used as whole-page implementation assets",
  ],
};
await fs.writeFile(
  path.join(root, "asset-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    originals: records.length,
    originalsBytes: records.reduce((s, x) => s + x.source.bytes, 0),
    derivativesBytes: records.reduce(
      (s, x) => s + x.derivative.bytes + (x.thumbnail?.bytes ?? 0),
      0,
    ),
    manifest: "docs/design/jo-venta/asset-manifest.json",
  }),
);
