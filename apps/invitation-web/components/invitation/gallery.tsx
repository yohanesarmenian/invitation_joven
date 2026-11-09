"use client";
import Image from "next/image";
import { useContext, useEffect, useRef, useState } from "react";
import { weddingMedia } from "../../src/presentation/wedding-media";
import { InvitationContentVisible } from "./invitation-opening-context";
const frames = [
  {
    ...weddingMedia.gallery[0],
    variant: "gallery-frame-large",
    sizes: "(min-width: 1200px) 1152px, calc(100vw - 48px)",
  },
  {
    ...weddingMedia.gallery[1],
    variant: "gallery-frame-small",
    sizes: "(min-width: 1200px) 564px, calc(50vw - 36px)",
  },
  {
    ...weddingMedia.gallery[2],
    variant: "gallery-frame-medium",
    sizes: "(min-width: 1200px) 564px, calc(50vw - 36px)",
  },
  {
    ...weddingMedia.gallery[3],
    variant: "gallery-frame-tall",
    sizes: "(min-width: 1200px) 1152px, calc(100vw - 48px)",
  },
] as const;
export function InvitationGallery() {
  const contentVisible = useContext(InvitationContentVisible);
  const [selected, setSelected] = useState<number | null>(null),
    dialog = useRef<HTMLDialogElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const open = selected !== null,
    frame = selected === null ? null : frames[selected];
  useEffect(() => {
    if (!open || !dialog.current) return;
    const modal = dialog.current,
      previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    modal.showModal();
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  function move(delta: number) {
    setSelected((index) =>
      index === null ? null : (index + delta + frames.length) % frames.length,
    );
  }
  return (
    <>
      <div className="gallery-mosaic">
        {frames.map((item, index) => (
          <button
            type="button"
            key={item.src}
            className={`gallery-frame ${item.variant}`}
            aria-label={`View pre-wedding photograph ${index + 1}`}
            onClick={() => setSelected(index)}
          >
            {contentVisible && (
              <Image
                src={item.src}
                alt=""
                fill
                sizes={item.sizes}
                style={{ objectPosition: item.position }}
              />
            )}
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="gallery-dialog"
        aria-label="Pre-wedding photo viewer"
        onClose={() => setSelected(null)}
        onCancel={() => setSelected(null)}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const buttons =
              dialog.current?.querySelectorAll<HTMLButtonElement>("button");
            const first = buttons?.[0],
              last = buttons?.[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        <button ref={close} type="button" onClick={() => setSelected(null)}>
          Close photo viewer
        </button>
        {frame && (
          <div className="gallery-dialog-image">
            <Image
              key={frame.fullSrc}
              src={frame.fullSrc}
              alt={`Jo and Venta, pre-wedding photograph ${selected! + 1}`}
              fill
              sizes="90vw"
              style={{ objectFit: "contain" }}
            />
          </div>
        )}
        <div className="gallery-dialog-actions">
          <button type="button" onClick={() => move(-1)}>
            Previous photo
          </button>
          <p aria-live="polite">
            Photo {(selected ?? 0) + 1} of {frames.length}
          </p>
          <button type="button" onClick={() => move(1)}>
            Next photo
          </button>
        </div>
      </dialog>
    </>
  );
}
