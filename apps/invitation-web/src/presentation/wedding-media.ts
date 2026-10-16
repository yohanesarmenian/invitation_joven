// Original owner photos supplied in gambar-edit. See docs/design/jo-venta/asset-manifest.json.
// The old approved flattened hero is retained as an explicit image-failure fallback.
import { ownerPhotography } from "./wedding-media.generated";

export const weddingMedia = {
  hero: ownerPhotography.cover,
  heroFallback: "/assets/hero/opened-hero.png",
  bride: ownerPhotography.venta,
  groom: ownerPhotography.jo,
  gallery: [
    {
      src: ownerPhotography.pic02,
      fullSrc: ownerPhotography.pic02,
      position: "50% 50%",
    },
    {
      src: ownerPhotography.pic03,
      fullSrc: ownerPhotography.pic03,
      position: "52% 65%",
    },
    {
      src: ownerPhotography.pic01,
      fullSrc: ownerPhotography.pic01,
      position: "50% 50%",
    },
    {
      src: ownerPhotography.cover,
      fullSrc: ownerPhotography.cover,
      position: "50% 58%",
    },
  ],
} as const;
