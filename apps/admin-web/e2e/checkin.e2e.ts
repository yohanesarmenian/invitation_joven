import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
test.use({ screenshot: "off", trace: "off" });
test("camera decodes a synthetic QR stream, stops tracks and only validates", async ({
  page,
}) => {
  const publicRequire = createRequire(
    resolve(process.cwd(), "../invitation-web/package.json"),
  );
  const { QRCodeSVG } = publicRequire("qrcode.react") as {
    QRCodeSVG: ComponentType<{
      value: string;
      size: number;
      marginSize: number;
    }>;
  };
  const svg = renderToStaticMarkup(
    createElement(QRCodeSVG, {
      value: "a".repeat(43),
      size: 256,
      marginSize: 4,
    }),
  ).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  await page.addInitScript(async (imageSource: string) => {
    Reflect.set(window, "decodedCameraTracksStopped", 0);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const image = new Image(),
          url = URL.createObjectURL(
            new Blob([imageSource], { type: "image/svg+xml" }),
          );
        image.src = url;
        await image.decode();
        const stream = canvas.captureStream(15);
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            Reflect.set(
              window,
              "decodedCameraTracksStopped",
              Reflect.get(window, "decodedCameraTracksStopped") + 1,
            );
            stop();
          };
        }
        return stream;
      },
    });
  }, svg);
  await enter(page, "scanner-decode@example.com");
  let validations = 0,
    confirmations = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/checkin/validate")) validations++;
    if (path.endsWith("/checkin/confirm")) confirmations++;
  });
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(
    page.getByRole("heading", { name: "Scanner Household", exact: true }),
  ).toBeVisible();
  expect(validations).toBe(1);
  expect(confirmations).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "decodedCameraTracksStopped")),
    )
    .toBeGreaterThan(0);
  await expect(page.locator("video")).toHaveCount(0);
});
async function enter(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/");
  await page.goto("/checkin");
  await page
    .getByLabel("Event", { exact: true })
    .selectOption({ label: "Reception" });
}
test("QR preview requires an explicit count and confirmation; input changes discard it", async ({
  page,
}) => {
  await enter(page, "scanner-qr@example.com");
  let confirms = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/admin/checkin/confirm")
      confirms++;
  });
  await page.getByLabel("QR code", { exact: true }).fill("a".repeat(43));
  await page.getByRole("button", { name: "Validate QR", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scanner Household" }),
  ).toBeVisible();
  expect(confirms).toBe(0);
  await page.getByLabel("QR code", { exact: true }).fill("b".repeat(43));
  await expect(
    page.getByRole("button", { name: "Confirm check-in", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Validate QR", exact: true }).click();
  await page.getByLabel("People arriving now").fill("2");
  await page
    .getByRole("button", { name: "Confirm check-in", exact: true })
    .dblclick();
  await expect(
    page.getByRole("heading", { name: "Check-in confirmed", exact: true }),
  ).toBeVisible();
  expect(confirms).toBe(1);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect(page.url()).not.toContain("b".repeat(43));
});
test("lost manual confirmation response reconciles exact IDs without replaying writes", async ({
  page,
}) => {
  await enter(page, "scanner-lost-response@example.com");
  let writes = 0;
  const reads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/manual-confirm")) writes++;
    if (path.endsWith("/manual-status")) reads.push(request.postData() ?? "");
  });
  await page.getByLabel("Household name").fill("Scanner");
  await page.getByRole("button", { name: "Search households" }).click();
  await page
    .getByRole("button", { name: /Scanner Household · expected/ })
    .click();
  await page
    .getByRole("button", { name: "Confirm check-in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check the server before continuing" }),
  ).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByLabel("Event", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Recheck exact household and event" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Already confirmed", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(reads).toHaveLength(1);
  expect(JSON.parse(reads[0]!)).toEqual({
    invitationId: "22222222-2222-4222-8222-222222222222",
    eventId: "11111111-1111-4111-8111-111111111111",
  });
});
test("late validation does not overwrite a changed event", async ({ page }) => {
  await enter(page, "scanner-delayed@example.com");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/checkin/validate", async (route) => {
    await hold;
    await route.continue();
  });
  await page.getByLabel("QR code", { exact: true }).fill("a".repeat(43));
  await page.getByRole("button", { name: "Validate QR", exact: true }).click();
  await page
    .getByLabel("Event", { exact: true })
    .selectOption({ label: "Ceremony" });
  release();
  await expect(
    page.getByRole("button", { name: "Confirm check-in", exact: true }),
  ).toHaveCount(0);
});
test("camera denial leaves manual fallback available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        Promise.reject(new DOMException("Synthetic denial", "NotAllowedError")),
      configurable: true,
    });
  });
  await enter(page, "scanner-camera-denied@example.com");
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.getByText(/Camera permission denied/)).toBeVisible();
  await expect(page.getByLabel("QR code", { exact: true })).toBeEnabled();
});
test("event changes and sign-out release every owned camera track", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { cameraOpened: 0, cameraStopped: 0 });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const stream = canvas.captureStream(10);
        Reflect.set(
          window,
          "cameraOpened",
          Reflect.get(window, "cameraOpened") + 1,
        );
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            Reflect.set(
              window,
              "cameraStopped",
              Reflect.get(window, "cameraStopped") + 1,
            );
            stop();
          };
        }
        return stream;
      },
    });
  });
  await enter(page, "scanner-camera-cleanup@example.com");
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "cameraOpened")))
    .toBe(1);
  await page
    .getByLabel("Event", { exact: true })
    .selectOption({ label: "Ceremony" });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "cameraStopped")))
    .toBeGreaterThan(0);
  await expect(page.locator("video")).toHaveCount(0);
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "cameraOpened")))
    .toBe(2);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/login");
});

for (const error of ["NotFoundError", "NotReadableError"]) {
  test(`camera ${error} retains typed QR and household search fallbacks`, async ({
    page,
  }) => {
    await page.addInitScript((name: string) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          throw new DOMException("Synthetic camera failure", name);
        },
      });
    }, error);
    await enter(page, "scanner-camera-failure@example.com");
    await page.getByRole("button", { name: "Start camera" }).click();
    await expect(page.getByText(/Camera unavailable or busy/)).toBeVisible();
    await expect(page.getByLabel("QR code", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Household name")).toBeEnabled();
    await expect(page.locator("video")).toHaveCount(0);
  });
}

test("camera selection, hidden tab, pagehide and explicit stop end the actual owned tracks", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { scannerTracks: [], scannerConstraints: [] });
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () =>
        ["rear", "front"].map((deviceId) => ({
          deviceId,
          kind: "videoinput",
          label: deviceId,
          groupId: "synthetic",
        })),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        Reflect.get(window, "scannerConstraints").push(constraints);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const stream = canvas.captureStream(10);
        Reflect.get(window, "scannerTracks").push(...stream.getTracks());
        return stream;
      },
    });
  });
  await enter(page, "scanner-camera-lifecycle@example.com");
  const tracks = () =>
    page.evaluate(() =>
      (Reflect.get(window, "scannerTracks") as MediaStreamTrack[]).map(
        (track) => track.readyState,
      ),
    );
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect.poll(tracks).toEqual(["live"]);
  expect(
    await page.evaluate(
      () => Reflect.get(window, "scannerConstraints")[0].video.facingMode.ideal,
    ),
  ).toBe("environment");
  await page
    .getByRole("combobox", { name: "Camera", exact: true })
    .selectOption("front");
  await expect.poll(tracks).toEqual(["ended", "live"]);
  expect(
    await page.evaluate(
      () => Reflect.get(window, "scannerConstraints")[1].video.deviceId.exact,
    ),
  ).toBe("front");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(tracks).toEqual(["ended", "ended"]);
  await expect(page.locator("video")).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    }),
  );
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect.poll(tracks).toEqual(["ended", "ended", "live"]);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(tracks).toEqual(["ended", "ended", "ended"]);
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect.poll(tracks).toEqual(["ended", "ended", "ended", "live"]);
  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect.poll(tracks).toEqual(["ended", "ended", "ended", "ended"]);
});
