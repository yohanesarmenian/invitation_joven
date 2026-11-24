import type { Page } from "@playwright/test";

export async function installSyntheticCamera(page: Page, svg: string) {
  const source = svg.includes("xmlns=")
    ? svg
    : svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  // Both journeys scan the rasterized guest-rendered SVG with real ZXing.
  await page.addInitScript((source: string) => {
    Reflect.set(window, "journeyStoppedTracks", 0);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 320;
        const context = canvas.getContext("2d")!;
        const svg = new DOMParser().parseFromString(
          source,
          "image/svg+xml",
        ).documentElement;
        const modules = Number(
          svg.getAttribute("viewBox")?.trim().split(/\s+/)[2],
        );
        const framings = [{ size: canvas.width, angle: 0 }];
        if (Number.isInteger(modules) && modules > 0 && modules * 6 <= 250) {
          // Render on whole module boundaries before sizing the camera frames.
          svg.setAttribute("width", String(modules * 10));
          svg.setAttribute("height", String(modules * 10));
          // Give the finder different views of the same QR, as a guest would.
          framings.push(
            { size: modules * 5, angle: 0 },
            { size: modules * 6, angle: -8 },
            { size: modules * 6, angle: 12 },
          );
        }
        const image = new Image();
        const url = URL.createObjectURL(
          new Blob([svg.outerHTML], { type: "image/svg+xml" }),
        );
        try {
          image.src = url;
          await image.decode();
        } finally {
          URL.revokeObjectURL(url);
        }
        let frame = 0;
        function paint() {
          // Hold each framing across multiple decoder scan intervals.
          const { size, angle } =
            framings[Math.floor(frame / 8) % framings.length]!;
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.save();
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate((angle * Math.PI) / 180);
          context.imageSmoothingEnabled = angle !== 0;
          const origin = -Math.floor(size / 2);
          context.drawImage(image, origin, origin, size, size);
          context.restore();
        }
        paint();

        const stream = canvas.captureStream(0);
        const [track] =
          stream.getVideoTracks() as CanvasCaptureMediaStreamTrack[];
        if (!track) throw new Error("Synthetic camera has no video track");
        const stop = track.stop.bind(track);
        // Couple capture to each paint without relying on animation callbacks.
        // Keep producing frames after getUserMedia returns and the video attaches.
        const timer = window.setInterval(() => {
          frame++;
          track.requestFrame();
          paint();
        }, 1000 / 15);
        track.stop = () => {
          window.clearInterval(timer);
          if (track.readyState === "ended") return;
          stop();
          Reflect.set(
            window,
            "journeyStoppedTracks",
            Reflect.get(window, "journeyStoppedTracks") + 1,
          );
        };
        return stream;
      },
    });
  }, source);
}
