import { MOCK_API_ORIGIN } from "./harness";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { SubmitPublicRsvpRequest } from "../../../packages/api-client/src/index";

const MOCK = MOCK_API_ORIGIN;
const PATH = `/i/${"A".repeat(43)}`;
const browserErrors = new WeakMap<Page, string[]>();
const accepted = {
  status: "ACCEPTED",
  version: 7,
  partyMode: "PLUS_ONE",
  dietaryNotes: "No seafood",
  attendeeQuantityTotal: 2,
  attendees: [
    { type: "NAMED_INVITEE", inviteeId: "invitee-test-1", quantity: 1 },
    { type: "PLUS_ONE", inviteeId: null, quantity: 1 },
  ],
  eventSelections: [
    { eventId: "event-test-1", attending: true, expectedAttendeeCount: 2 },
    { eventId: "event-test-2", attending: false, expectedAttendeeCount: 0 },
  ],
};

async function configure(request: APIRequestContext, data: unknown) {
  expect((await request.post(`${MOCK}/__rsvp-fixture`, { data })).ok()).toBe(
    true,
  );
}

async function submissions(
  request: APIRequestContext,
): Promise<SubmitPublicRsvpRequest[]> {
  const response = await request.get(`${MOCK}/__rsvp-state`);
  return (await response.json()).requests;
}

async function open(page: Page) {
  await page.goto(PATH);
  await page.getByRole("button", { name: "Buka Undangan" }).click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
}

function heroAction(page: Page, name: string) {
  return page
    .locator(".invitation-hero")
    .getByRole("link", { name, exact: true });
}

async function editSaved(page: Page) {
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ubah RSVP", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Simpan Perubahan", exact: true }),
  ).toBeVisible();
  await expectPass(page, null);
}

async function accept(page: Page) {
  await page.getByRole("radio", { name: "Dengan senang hati hadir" }).check();
  await page
    .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
    .check();
  await page
    .getByRole("radio", { name: "Saya hadir sendiri", exact: true })
    .check();
}

const firstPass = "fixture-pass-1-".padEnd(43, "x");
const secondPass = "fixture-pass-2-".padEnd(43, "x");

async function expectPass(page: Page, payload: string | null) {
  const pass = page.getByRole("region", { name: "QR Check-in Anda" });
  if (payload === null) {
    await expect(pass).toHaveCount(0);
    await expect(page.locator(".checkin-code")).toHaveCount(0);
  } else {
    await expect(pass).toHaveCount(1);
    await expect(
      pass.getByRole("heading", { name: "QR Check-in Anda" }),
    ).toBeVisible();
    await expect(
      pass.getByRole("img", { name: "Kode QR untuk check-in rombongan Anda" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await pass.locator(".checkin-code").textContent()) === payload,
      )
      .toBe(true);
    await expect(
      pass.getByText("Kode check-in", { exact: true }),
    ).toBeVisible();
    await expect(pass.locator("a, input, [hidden]")).toHaveCount(0);
  }
  // The application must not duplicate the credential into element attributes.
  expect(
    await page
      .locator(".public-rsvp-form")
      .evaluate((form) =>
        [...form.querySelectorAll("*")].some((element) =>
          [...element.attributes].some((attribute) =>
            attribute.value.includes("fixture-pass-"),
          ),
        ),
      ),
  ).toBe(false);
}

async function assertPassLayout(page: Page) {
  const pass = page.locator(".guest-checkin-pass");
  await page.evaluate(() => document.fonts.ready);
  await pass.scrollIntoViewIfNeeded();
  await pass.locator("img").evaluateAll((nodes) => {
    nodes.forEach((node) => {
      (node as HTMLImageElement).loading = "eager";
    });
  });
  await expect
    .poll(() =>
      pass.locator("img").evaluateAll(
        (nodes) =>
          nodes.filter((node) => {
            const image = node as HTMLImageElement;
            return !image.complete || image.naturalWidth === 0;
          }).length,
      ),
    )
    .toBe(0);
  const geometry = await pass.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const qr = element.querySelector("svg")!.getBoundingClientRect();
    const code = element.querySelector("code")!;
    return {
      square: Math.abs(qr.width - qr.height) < 1,
      readableSize: qr.width >= 200,
      contained:
        qr.left >= box.left &&
        qr.right <= box.right &&
        box.left >= 0 &&
        box.right <= innerWidth,
      wraps:
        getComputedStyle(code).overflowWrap === "anywhere" &&
        code.scrollWidth <= code.clientWidth,
      selectable: getComputedStyle(code).userSelect === "text",
      overlaps: [
        ...document.querySelectorAll(
          ".rsvp-information-section .invitation-decoration",
        ),
      ].some((art) => {
        const rect = art.getBoundingClientRect();
        return (
          rect.left < qr.right &&
          rect.right > qr.left &&
          rect.top < qr.bottom &&
          rect.bottom > qr.top
        );
      }),
    };
  });
  expect(geometry).toEqual({
    square: true,
    readableSize: true,
    contained: true,
    wraps: true,
    selectable: true,
    overlaps: false,
  });
  // Geometry assertions provide QR layout proof without capturing bearer material.
}

test.beforeEach(async ({ request, page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  expect((await request.post(`${MOCK}/__reset`)).status()).toBe(204);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
  expect(page.url().includes("fixture-pass-")).toBe(false);
  expect(
    await page.evaluate(() =>
      [
        JSON.stringify(localStorage),
        JSON.stringify(sessionStorage),
        document.cookie,
      ].some((value) => value.includes("fixture-pass-")),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

async function noticeScreenshot(page: Page, info: TestInfo, name: string) {
  const notice = page.locator(".rsvp-notice");
  await expect(notice).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const layout = await notice.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      clipped:
        box.left < 0 ||
        box.right > innerWidth ||
        element.scrollWidth > element.clientWidth + 1,
      smallActions: [...element.querySelectorAll("button")].some(
        (button) => button.getBoundingClientRect().height < 44,
      ),
      overlaps: [
        ...document.querySelectorAll(
          ".rsvp-information-section .invitation-decoration",
        ),
      ].some((art) => {
        const rect = art.getBoundingClientRect();
        return (
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top
        );
      }),
    };
  });
  expect(layout).toEqual({
    clipped: false,
    smallActions: false,
    overlaps: false,
  });
  await notice.screenshot({
    path: info.outputPath(`${name}.png`),
    animations: "disabled",
  });
}

for (const width of [320, 375, 412, 768, 1280]) {
  test(`RSVP create, edit and decline at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await configure(request, {
      rules: { allowPlusOne: true, maxAdditionalChildren: 2 },
      nextVersion: 42,
    });
    await open(page);
    await expect(heroAction(page, "Konfirmasi Kehadiran")).toBeVisible();
    await expectPass(page, null);
    const form = page.getByRole("form", { name: "RSVP Anda" });
    await expect(form.locator("input:checked")).toHaveCount(0);
    await accept(page);
    await expect(heroAction(page, "Konfirmasi Kehadiran")).toBeVisible();
    await page
      .getByRole("radio", {
        name: "Holy Matrimony Test & Reception Test",
        exact: true,
      })
      .check();
    await page
      .getByRole("radio", { name: "Saya hadir bersama keluarga", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Sertakan satu pendamping tambahan" })
      .check();
    await page.getByRole("checkbox", { name: "Sertakan anak" }).check();
    await page.getByRole("spinbutton", { name: /anak tambahan/i }).fill("2");
    const dietary = page.getByRole("textbox", {
      name: "Kebutuhan dan preferensi makanan (opsional)",
    });
    await dietary.fill("No seafood");
    await expect(
      page.getByText("4 orang akan hadir di setiap sesi yang dipilih."),
    ).toBeVisible();
    await expect(dietary).toHaveAttribute("maxlength", "500");
    await dietary.fill("x".repeat(501));
    await expect(dietary).toHaveValue("x".repeat(500));
    await dietary.fill("  No seafood  ");

    // Inspect inner form geometry too: the invitation surface clips overflow.
    const geometry = await form.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const controls = [
        ...element.querySelectorAll("input, textarea, button, label"),
      ];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: controls.some((control) => {
          const rect = control.getBoundingClientRect();
          return rect.left < box.left - 1 || rect.right > box.right + 1;
        }),
        smallTargets: [
          ...element.querySelectorAll(
            '.rsvp-choice, input[type="number"], textarea, button',
          ),
        ].filter((control) => control.getBoundingClientRect().height < 44)
          .length,
        decorationOverlap: [
          ...document.querySelectorAll(
            ".rsvp-information-section .invitation-decoration",
          ),
        ].some((decoration) => {
          const art = decoration.getBoundingClientRect();
          return controls.some((control) => {
            const rect = control.getBoundingClientRect();
            return (
              rect.left < art.right &&
              rect.right > art.left &&
              rect.top < art.bottom &&
              rect.bottom > art.top
            );
          });
        }),
      };
    });
    expect(geometry).toEqual({
      overflow: false,
      clipped: false,
      smallTargets: 0,
      decorationOverlap: false,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".rsvp-information-section").screenshot({
      path: testInfo.outputPath(`rsvp-${width}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Konfirmasi kehadiran Anda telah tersimpan.");
    expect((await submissions(request))[0]).toEqual({
      expectedVersion: null,
      status: "ACCEPTED",
      partyMode: "FAMILY",
      attendees: [
        { type: "NAMED_INVITEE", inviteeId: "invitee-test-1", quantity: 1 },
        { type: "PLUS_ONE", inviteeId: null, quantity: 1 },
        { type: "ADDITIONAL_CHILD", inviteeId: null, quantity: 2 },
      ],
      eventSelections: [
        { eventId: "event-test-1", attending: true, expectedAttendeeCount: 4 },
        { eventId: "event-test-2", attending: true, expectedAttendeeCount: 4 },
      ],
      dietaryNotes: "No seafood",
    });
    await expect(
      page.getByRole("heading", {
        name: "Kehadiran Terkonfirmasi",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dietary).toHaveCount(0);
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("sebelum batas waktu RSVP");
    await noticeScreenshot(page, testInfo, `accepted-${width}`);
    await expectPass(page, firstPass);
    await expect(heroAction(page, "Lihat QR Check-in")).toBeVisible();
    await assertPassLayout(page);
    const originalModules = await page
      .locator(".guest-checkin-pass svg")
      .innerHTML();
    await editSaved(page);
    await page.getByRole("form", { name: "RSVP Anda" }).screenshot({
      path: testInfo.outputPath(`rsvp-edit-${width}.png`),
    });
    await page.getByRole("button", { name: "Batal", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expectPass(page, firstPass);
    await page.getByRole("button", { name: "Ubah RSVP", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expectPass(page, null);
    await expect(dietary).toHaveValue("No seafood");
    await page
      .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
      .check();
    await dietary.fill("");
    const successNotice = page.locator("[data-rsvp-mutation-success]");
    await expect(successNotice).toHaveCount(0);
    await page
      .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Konfirmasi kehadiran Anda telah tersimpan.");
    await expect(successNotice).toBeVisible();
    const update = (await submissions(request))[1]!;
    expect(update.expectedVersion).toBe(42);
    expect(update.dietaryNotes).toBeNull();
    expect(update.eventSelections).toEqual([
      { eventId: "event-test-1", attending: true, expectedAttendeeCount: 4 },
    ]);
    expect(update).not.toHaveProperty("guestNote");
    await expectPass(page, firstPass);
    expect(
      (await page.locator(".guest-checkin-pass svg").innerHTML()) ===
        originalModules,
    ).toBe(true);

    // Re-read dedicated RSVP state on a new invitation load.
    await open(page);
    await expectPass(page, firstPass);
    await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    await editSaved(page);
    await expect(
      page.getByRole("radio", { name: "Dengan senang hati hadir" }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Holy Matrimony Test", exact: true }),
    ).toBeChecked();
    await page
      .getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" })
      .check();
    await expect(dietary).toHaveCount(0);
    await page.getByRole("radio", { name: "Dengan senang hati hadir" }).check();
    await expect(
      page.getByRole("radio", { name: "Holy Matrimony Test", exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("spinbutton", { name: /anak tambahan/i }),
    ).toHaveCount(0);
    await page
      .getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" })
      .check();
    await expect(successNotice).toHaveCount(0);
    await page
      .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Jawaban Anda telah tersimpan sebagai tidak hadir.");
    await expect(successNotice).toBeVisible();
    expect((await submissions(request))[2]).toEqual({
      expectedVersion: 43,
      status: "DECLINED",
      attendees: [],
      eventSelections: [],
      dietaryNotes: null,
    });
    await noticeScreenshot(page, testInfo, `declined-${width}`);
    await expectPass(page, null);
    await expect(heroAction(page, "Lihat Jawaban RSVP")).toBeVisible();
    expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
      false,
    );
    await editSaved(page);
    await page.getByRole("radio", { name: "Dengan senang hati hadir" }).check();
    await expect(dietary).toHaveCount(0);
    await accept(page);
    await page
      .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Konfirmasi kehadiran Anda telah tersimpan.");
    await expectPass(page, secondPass);
    expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
      false,
    );
    expect(
      (await page.locator(".guest-checkin-pass svg").innerHTML()) ===
        originalModules,
    ).toBe(false);
    expect((await submissions(request))[3]!.expectedVersion).toBe(44);
    expect(errors).toEqual([]);
    await expect(
      page.locator(
        ".guest-message-section input, .guest-message-section textarea",
      ),
    ).toHaveCount(2);
    await expect(page.locator("body")).not.toContainText("A".repeat(43));
  });
}

test("validates progressive choice and incomplete family before a request", async ({
  page,
  request,
}) => {
  await configure(request, {
    rules: { allowPlusOne: true, maxAdditionalChildren: 2 },
  });
  await open(page);
  const send = page.getByRole("button", { name: "Kirim RSVP", exact: true });
  const alert = page.locator(".rsvp-information-section").getByRole("alert");
  await send.click();
  await expect(alert).toContainText("Silakan pilih apakah Anda dapat hadir.");
  await expect(alert).toBeFocused();
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveAttribute(
    "aria-describedby",
    /error/,
  );
  await page.getByRole("radio", { name: "Dengan senang hati hadir" }).check();
  await send.click();
  await expect(alert).toContainText("Silakan pilih sesi pernikahan");
  await page
    .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
    .check();
  await send.click();
  await expect(alert).toContainText("Silakan pilih siapa yang akan hadir.");
  await page
    .getByRole("radio", { name: "Saya hadir bersama keluarga", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Sertakan anak", exact: true })
    .check();
  await send.click();
  await expect(alert).toContainText(
    "Silakan pilih nama anak yang diundang atau isi jumlah",
  );
  const count = page.getByRole("spinbutton", { name: /anak tambahan/i });
  await count.fill("3");
  await send.click();
  await expect(alert).toContainText("Silakan periksa jumlah anak tambahan");
  expect(await submissions(request)).toHaveLength(0);
  await count.fill("2");
  await expect(
    page.getByText("3 orang akan hadir di setiap sesi yang dipilih."),
  ).toBeVisible();
});

for (const width of [320, 375, 412, 1280]) {
  test(`conflict reload and deadline notices at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(request, {
      rsvp: accepted,
      deadline: "2031-11-08T16:59:59Z",
    });
    await open(page);
    await editSaved(page);
    const dietary = page.locator(".public-rsvp-form").getByRole("textbox");
    await expectPass(page, null);
    const send = page.getByRole("button", {
      name: /^(Kirim RSVP|Simpan Perubahan)$/,
    });
    const alert = page.locator(".rsvp-information-section").getByRole("alert");
    await dietary.fill("My unsaved changes");
    await configure(request, {
      rsvp: { ...accepted, version: 23, dietaryNotes: "Saved elsewhere" },
      checkinPass: {
        status: "ACTIVE",
        issuedAt: "2026-09-30T00:00:00Z",
        qrPayload: secondPass,
      },
    });
    await send.click();
    await expect(alert).toContainText("diperbarui setelah Anda membuka");
    await expect(alert).toBeFocused();
    await expect(dietary).toHaveValue("My unsaved changes");
    await expect(send).toBeDisabled();
    await expectPass(page, null);
    await noticeScreenshot(page, info, `conflict-${width}`);
    await dietary.fill("Keep this draft until I reload");
    await expect(send).toBeDisabled();
    await page
      .getByRole("form", { name: "RSVP Anda" })
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(await submissions(request)).toHaveLength(1);

    // A failed GET must retain both the draft and the conflict lock.
    await configure(request, {
      failure: { status: 503, code: "UNEXPECTED", method: "GET" },
    });
    const reload = page.getByRole("button", { name: "Muat Ulang RSVP" });
    await reload.focus();
    await page.keyboard.press("Enter");
    await expect(alert).toContainText("belum bisa dimuat");
    await expect(alert).toBeFocused();
    await expect(dietary).toHaveValue("Keep this draft until I reload");
    await expectPass(page, null);
    await expect(send).toBeDisabled();
    expect(await submissions(request)).toHaveLength(1);

    await configure(request, {});
    await reload.click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Jawaban RSVP terbaru sudah dimuat");
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toBeFocused();
    await editSaved(page);
    await expect(dietary).toHaveValue("Saved elsewhere");
    await expectPass(page, null);
    expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
      false,
    );
    await expect(send).toBeEnabled();
    expect((await (await request.get(`${MOCK}/__count`)).json()).count).toBe(1);
    await dietary.fill("My reviewed response");
    await send.click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Konfirmasi kehadiran Anda telah tersimpan");
    expect((await submissions(request))[1]!.expectedVersion).toBe(23);

    await editSaved(page);
    const beforeDeadline = await request.get(`${MOCK}/__rsvp-state`);
    const { reads } = await beforeDeadline.json();
    await configure(request, {
      failure: { status: 422, code: "RSVP_DEADLINE_PASSED", method: "PATCH" },
    });
    await send.click();
    await expect(alert).toContainText("RSVP sudah ditutup");
    await expect(alert).toBeFocused();
    await expect(
      page.getByText(
        "Mohon berikan jawaban paling lambat 8 November 2031 pukul 23.59 WIB.",
      ),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(dietary).toBeDisabled();
    await expectPass(page, null);
    await expect(dietary).toHaveValue("My reviewed response");
    await expect(
      page.getByRole("button", { name: /Coba Lagi|Muat Ulang RSVP/ }),
    ).toHaveCount(0);
    await noticeScreenshot(page, info, `deadline-${width}`);
    await page
      .getByRole("form", { name: "RSVP Anda" })
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(await submissions(request)).toHaveLength(3);
    await page.getByRole("button", { name: "Batal", exact: true }).click();
    await expectPass(page, secondPass);
    await expect(page.getByRole("button", { name: "Ubah RSVP" })).toHaveCount(
      0,
    );
    await expect(alert).toContainText("RSVP sudah ditutup");
    const shortcut = heroAction(page, "Lihat QR Check-in");
    await expect(shortcut).toHaveAttribute("href", "#checkin-pass-title");
    await shortcut.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "QR Check-in Anda" }),
    ).toBeFocused();
    const afterShortcut = await request.get(`${MOCK}/__rsvp-state`);
    expect(await afterShortcut.json()).toMatchObject({ reads: reads + 1 });
    expect(await submissions(request)).toHaveLength(3);
    await expect(page.getByText("See you at the Wedding!")).toBeAttached();
  });
}

for (const [outcome, recovery] of [
  ["revoked", null],
  ["replaced", null],
  ["read failed", "unavailable"],
  ["read failed", "replacement"],
] as const) {
  test(`deadline rejection never restores an old QR when revalidation shows ${outcome}${recovery ? `, then recovery finds ${recovery}` : ""}`, async ({
    page,
    request,
  }) => {
    const replacement = {
      status: "ACTIVE",
      issuedAt: "2026-09-30T00:00:00Z",
      qrPayload: secondPass,
    };
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await configure(request, { rsvp: accepted });
    await open(page);
    await expectPass(page, firstPass);
    await editSaved(page);
    const before = await request.get(`${MOCK}/__rsvp-state`);
    const { reads } = await before.json();
    const readFailure = { status: 503, code: "UNEXPECTED" };
    await configure(request, {
      failure: { status: 422, code: "RSVP_DEADLINE_PASSED", method: "PATCH" },
      ...(outcome === "revoked" && { checkinPass: null }),
      ...(outcome === "replaced" && { checkinPass: replacement }),
      ...(recovery && { readFailure }),
    });
    await page
      .getByRole("button", { name: "Simpan Perubahan", exact: true })
      .click();
    const alert = page.locator(".rsvp-information-section").getByRole("alert");
    await expect(alert).toContainText("RSVP sudah ditutup");
    await expectPass(page, null);
    await expect(heroAction(page, "Lihat QR Check-in")).toHaveCount(0);
    await page.getByRole("button", { name: "Batal", exact: true }).click();
    await expect(alert).toContainText("RSVP sudah ditutup");
    const confirmation = page.getByRole("region", {
      name: "Konfirmasi RSVP Anda",
      exact: true,
    });
    const verify = confirmation.getByRole("button", {
      name: "Periksa Ulang QR",
      exact: true,
    });
    const unverified = confirmation
      .getByRole("status")
      .filter({ hasText: "Status QR check-in belum terverifikasi." });
    const unavailable = confirmation
      .getByRole("status")
      .filter({ hasText: "QR check-in saat ini tidak tersedia." });
    const editButton = page.getByRole("button", {
      name: "Ubah RSVP",
      exact: true,
    });
    const expectLocked = async () => {
      await expect(alert).toContainText("RSVP sudah ditutup");
      await expect(editButton).toHaveCount(0);
      await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(
        0,
      );
    };
    const expectNavigation = async (hasQr: boolean) => {
      await browsePastHero(page);
      await expectStickyAction(
        page,
        hasQr ? "Lihat QR Check-in" : "Lihat RSVP",
        hasQr ? "checkin-pass-title" : "rsvp-title",
      );
    };

    await expectLocked();
    await expectPass(page, outcome === "replaced" ? secondPass : null);
    await expectNavigation(outcome === "replaced");
    await expectRsvpTraffic(request, reads + 1, 1);
    expect(await submissions(request)).toEqual([
      {
        expectedVersion: accepted.version,
        dietaryNotes: accepted.dietaryNotes,
      },
    ]);

    if (!recovery) {
      await expect(verify).toHaveCount(0);
      await expect(unverified).toHaveCount(0);
      await expect(unavailable).toHaveCount(outcome === "revoked" ? 1 : 0);
      return;
    }

    await expect(unverified).toBeVisible();
    await expect(unavailable).toHaveCount(0);
    await expect(verify).toBeEnabled();
    await expect(verify).toHaveAccessibleDescription(
      "Status QR check-in belum terverifikasi. Silakan periksa kembali.",
    );

    // Hold the server-action response after the API read completes, so the
    // browser stays pending while further activations are attempted.
    let release!: () => void;
    let markReadComplete!: () => void;
    const responseHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const readComplete = new Promise<void>((resolve) => {
      markReadComplete = resolve;
    });
    const isInvitation = (url: URL) => url.pathname === PATH;
    let actionRequests = 0;
    await page.route(isInvitation, async (route) => {
      if (
        route.request().method() !== "POST" ||
        !route.request().headers()["next-action"]
      ) {
        await route.continue();
        return;
      }
      actionRequests++;
      const response = await route.fetch({ maxRetries: 0 });
      markReadComplete();
      await responseHeld;
      await route.fulfill({ response });
    });
    try {
      await verify.scrollIntoViewIfNeeded();
      await expect(verify).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(321);
      await verify.focus();
      await page.keyboard.press("Enter");
      await expect(verify).toBeDisabled();
      await expect(verify).toHaveAccessibleDescription(
        "Memeriksa status QR check-in…",
      );
      await expect(verify).toBeFocused();
      await expect(
        confirmation.locator("[data-rsvp-mutation-success]"),
      ).toHaveCount(0);
      await readComplete;
      await verify.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await expectPass(page, null);
      await expect(confirmation).not.toContainText(firstPass);
      await expect(confirmation).not.toContainText(secondPass);
      await expect(heroAction(page, "Lihat RSVP")).toHaveAttribute(
        "href",
        "#rsvp-title",
      );
      await expectLocked();
      await expectRsvpTraffic(request, reads + 2, 1);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(verify).toBeEnabled();
    await expect(verify).toBeFocused();
    await expect(unverified).toBeVisible();
    await expect(unavailable).toHaveCount(0);
    await expectPass(page, null);
    await expectLocked();
    await expectNavigation(false);
    await expectRsvpTraffic(request, reads + 2, 1);
    expect(actionRequests).toBe(1);

    // The fixture advertises canEdit: true here. A fresh pass read cannot
    // clear the lock from the failed write.
    const hasQr = recovery === "replacement";
    await configure(request, { checkinPass: hasQr ? replacement : null });
    await verify.click();
    await expect(verify).toHaveCount(0);
    await expect(unverified).toHaveCount(0);
    if (hasQr) {
      await expect(
        confirmation.getByRole("heading", {
          name: "QR Check-in Anda",
          exact: true,
        }),
      ).toBeFocused();
    } else {
      await expect(unavailable).toBeFocused();
    }
    await expectPass(page, hasQr ? secondPass : null);
    await expect(confirmation).not.toContainText(firstPass);
    await expectLocked();
    await expectNavigation(hasQr);
    await expectRsvpTraffic(request, reads + 3, 1);
  });
}

for (const [path, outcome] of [
  ["automatic", "invitation unavailable"],
  ["manual", "invitation unavailable"],
  ["manual", "other 404"],
  ["manual", "transport failure"],
  ["manual", "declined"],
  ["manual", "no RSVP"],
] as const) {
  test(`deadline QR recovery handles ${path} ${outcome}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await configure(request, { rsvp: accepted });
    await open(page);
    await expectPass(page, firstPass);
    await editSaved(page);
    const unavailableRead = { status: 404, code: "INVITATION_NOT_AVAILABLE" };
    await configure(request, {
      failure: { status: 422, code: "RSVP_DEADLINE_PASSED", method: "PATCH" },
      readFailure:
        path === "automatic"
          ? unavailableRead
          : { status: 503, code: "UNEXPECTED" },
    });
    await page
      .getByRole("button", { name: "Simpan Perubahan", exact: true })
      .click();

    const section = page.locator(".rsvp-information-section");
    const alert = section.getByRole("alert");
    const verify = section.getByRole("button", {
      name: "Periksa Ulang QR",
      exact: true,
    });
    const confirmation = section.getByRole("region", {
      name: "Konfirmasi RSVP Anda",
    });
    const editor = section.getByRole("form", { name: "RSVP Anda" });
    const successNotice = section.locator("[data-rsvp-mutation-success]");
    const unverified = section
      .getByRole("status")
      .filter({ hasText: "Status QR check-in belum terverifikasi" });
    const absent = section
      .getByRole("status")
      .filter({ hasText: "QR check-in saat ini tidak tersedia." });

    if (path === "manual") {
      await expect(alert).toContainText("RSVP sudah ditutup");
      await page.getByRole("button", { name: "Batal", exact: true }).click();
      await expect(unverified).toBeVisible();
      await expectRsvpTraffic(request, 3, 1);
      const declined = {
        status: "DECLINED",
        version: accepted.version + 1,
        dietaryNotes: null,
        attendeeQuantityTotal: 0,
        attendees: [],
        eventSelections: [],
      };
      await configure(request, {
        ...(outcome === "invitation unavailable" && {
          readFailure: unavailableRead,
        }),
        ...(outcome === "other 404" && {
          readFailure: { status: 404, code: "UNEXPECTED" },
        }),
        ...(outcome === "transport failure" && { dropReadResponse: true }),
        ...(outcome === "declined" && { rsvp: declined }),
        ...(outcome === "no RSVP" && { rsvp: null, checkinPass: null }),
      });
      await verify.focus();
      await page.keyboard.press("Enter");
    }

    if (outcome === "invitation unavailable") {
      await expect(alert).toContainText("Undangan tidak tersedia");
      await expect(alert).toBeFocused();
      await expect(confirmation).toHaveCount(0);
      await expect(editor).toHaveCount(0);
      await expect(verify).toHaveCount(0);
      await expect(
        section.getByRole("button", { name: "Muat Ulang RSVP", exact: true }),
      ).toHaveCount(0);
      await expect(unverified).toHaveCount(0);
      await expect(
        section.getByText("No seafood", { exact: false }),
      ).toHaveCount(0);
    } else if (outcome === "declined") {
      await expect(
        confirmation.getByRole("heading", { name: "Tidak Hadir", exact: true }),
      ).toBeFocused();
      await expect(alert).toContainText("RSVP sudah ditutup");
      await expect(verify).toHaveCount(0);
      await expect(unverified).toHaveCount(0);
      await expect(editor).toHaveCount(0);
    } else if (outcome === "no RSVP") {
      await expect(confirmation).toHaveCount(0);
      await expect(alert).toContainText("RSVP sudah ditutup");
      await expect(alert).toBeFocused();
      await expect(
        editor.getByRole("button", { name: "Kirim RSVP", exact: true }),
      ).toBeDisabled();
      await expect(verify).toHaveCount(0);
    } else {
      await expect
        .poll(async () => {
          const response = await request.get(`${MOCK}/__rsvp-state`);
          return (await response.json()).reads;
        })
        .toBe(4);
      await expect(verify).toBeEnabled();
      await expect(unverified).toBeVisible();
      await expect(verify).toBeFocused();
      await expect(alert).toContainText("RSVP sudah ditutup");
      await expect(absent).toHaveCount(0);
      await expectPass(page, null);
      await expectRsvpTraffic(request, 4, 1);
      await configure(request, { checkinPass: null });
      await page.keyboard.press("Enter");
      await expect(absent).toBeFocused();
      await expect(verify).toHaveCount(0);
    }
    await expectPass(page, null);
    expect((await section.innerText()).includes(firstPass)).toBe(false);
    await expect(successNotice).toHaveCount(0);
    await expect(
      section.getByRole("button", { name: "Ubah RSVP", exact: true }),
    ).toHaveCount(0);
    await browsePastHero(page);
    await expectStickyAction(page, "Lihat RSVP", "rsvp-title");
    await expect(page.locator("#rsvp-title")).toBeAttached();
    const reads =
      path === "automatic"
        ? 3
        : outcome === "other 404" || outcome === "transport failure"
          ? 5
          : 4;
    await expectRsvpTraffic(request, reads, 1);
  });
}

test("ordinary reload feedback has no mutation-success marker", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted });
  await open(page);
  const status = page.locator(".public-rsvp-form").getByRole("status");
  const successNotice = page.locator("[data-rsvp-mutation-success]");
  await expect(successNotice).toHaveCount(0);
  await editSaved(page);
  await expect(status).toContainText("Jawaban RSVP terbaru sudah dimuat.");
  await expect(successNotice).toHaveCount(0);
  await expectRsvpTraffic(request, 2);
});

test("temporary server failure suspends the QR and requires reload before an explicit new edit", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: accepted,
    failure: { status: 500, code: "INTERNAL_SERVER_ERROR", method: "PATCH" },
  });
  await open(page);
  await editSaved(page);
  await page
    .getByLabel("Kebutuhan dan preferensi makanan (opsional)")
    .fill("Reviewed dietary notes");
  await page
    .getByRole("button", { name: "Simpan Perubahan", exact: true })
    .click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("alert"),
  ).toContainText("belum dapat memastikan apakah");
  await expect(page.locator("[data-rsvp-mutation-success]")).toHaveCount(0);
  await expectPass(page, null);
  await expect(
    page.getByRole("button", { name: "Simpan Perubahan", exact: true }),
  ).toBeDisabled();
  expect(await submissions(request)).toHaveLength(1);
  await configure(request, {});
  await page.getByRole("button", { name: "Muat Ulang RSVP" }).click();
  await expectPass(page, firstPass);
  await editSaved(page);
  await page
    .getByLabel("Kebutuhan dan preferensi makanan (opsional)")
    .fill("Reviewed dietary notes");
  await page
    .getByRole("button", { name: "Simpan Perubahan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Kehadiran Terkonfirmasi", exact: true }),
  ).toBeVisible();
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([7, 7]);
});

test("a lost save response recovers the committed result through GET without another mutation", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted, dropResponse: true });
  await open(page);
  await editSaved(page);
  await page
    .getByLabel("Kebutuhan dan preferensi makanan (opsional)")
    .fill("Saved but response lost");
  await page
    .getByRole("button", { name: "Simpan Perubahan", exact: true })
    .click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("alert"),
  ).toContainText("belum dapat memastikan apakah");
  await expect(page.locator("[data-rsvp-mutation-success]")).toHaveCount(0);
  await expectPass(page, null);
  await expect(
    page.getByRole("button", { name: "Simpan Perubahan", exact: true }),
  ).toBeDisabled();
  await configure(request, {});
  await page.getByRole("button", { name: "Muat Ulang RSVP" }).click();
  await expect(
    page.getByRole("heading", { name: "Kehadiran Terkonfirmasi", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".public-rsvp-form")).toContainText(
    "Saved but response lost",
  );
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
  await expectPass(page, firstPass);
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([7]);
});

test("initial read retry loads existing state without re-opening the invitation", async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await configure(request, {
    failure: { status: 503, code: "UNEXPECTED", method: "GET" },
  });
  await open(page);
  await expect(heroAction(page, "Lihat RSVP")).toBeVisible();
  await heroAction(page, "Lihat RSVP").click();
  await expect(page.locator("#rsvp-title")).toBeFocused();
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
  await expectPass(page, null);
  const reload = page.getByRole("button", { name: "Muat Ulang RSVP" });
  await expect(reload).toBeEnabled();
  await expect(heroAction(page, "Lihat RSVP")).toBeVisible();
  await noticeScreenshot(page, info, "initial-load-failure");
  await reload.click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("belum bisa dimuat");
  await expect(page.locator(".public-rsvp-form")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(reload).toBeEnabled();
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
  expect(await submissions(request)).toHaveLength(0);
  await configure(request, { rsvp: { ...accepted, version: 19 } });
  await reload.click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toBeFocused();
  await expect(heroAction(page, "Lihat QR Check-in")).toBeVisible();
  await editSaved(page);
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expectPass(page, null);
  await page
    .getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" })
    .check();
  await page
    .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
    .click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("tersimpan sebagai tidak hadir");
  expect((await submissions(request))[0]!.expectedVersion).toBe(19);
  expect((await (await request.get(`${MOCK}/__count`)).json()).count).toBe(1);
});

for (const [code, button, group] of [
  [
    "EVENT_NOT_SELECTED",
    "Periksa Pilihan Sesi",
    "Sesi mana yang akan Anda hadiri?",
  ],
  ["PLUS_ONE_NOT_ALLOWED", "Periksa Daftar Tamu", "Siapa yang akan hadir?"],
] as const) {
  test(`${code} guides correction without blind retry`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await configure(request, {
      rsvp: accepted,
      failure: { status: 422, code, method: "PATCH" },
    });
    await open(page);
    await editSaved(page);
    await page
      .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
      .click();
    const alert = page.locator(".rsvp-information-section").getByRole("alert");
    await expect(alert).toContainText("Periksa jawaban Anda");
    await expect(alert).toBeFocused();
    await expect(
      page.getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ }),
    ).toBeDisabled();
    await noticeScreenshot(page, info, code.toLowerCase());
    await page.getByRole("button", { name: button }).click();
    await expect(
      page.getByRole("group", { name: group, exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("group", { name: group, exact: true }),
    ).toHaveAttribute("aria-describedby", /error/);
    await configure(request, {});
    if (code === "PLUS_ONE_NOT_ALLOWED")
      await page
        .getByRole("radio", { name: "Saya hadir sendiri", exact: true })
        .check();
    else
      await page
        .getByRole("radio", { name: "Reception Test", exact: true })
        .check();
    await page
      .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Konfirmasi kehadiran Anda telah tersimpan");
    expect(
      (await submissions(request)).map((body) => body.expectedVersion),
    ).toEqual([7, 7]);
  });
}

test("unavailable mutation locks the form without disclosing a reason", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: accepted,
    failure: { status: 404, code: "INVITATION_NOT_AVAILABLE", method: "PATCH" },
  });
  await open(page);
  await editSaved(page);
  await page
    .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
    .click();
  const alert = page.locator(".rsvp-information-section").getByRole("alert");
  await expect(alert).toContainText("Undangan ini sudah tidak tersedia.");
  await expect(alert).not.toContainText(
    /archived|expired|credential|token|hash|INVITATION_NOT_AVAILABLE/,
  );
  await expect(
    page.getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ }),
  ).toBeDisabled();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expectPass(page, null);
  expect(await submissions(request)).toHaveLength(1);
});

test("pending state disables submission and prevents duplicate requests", async ({
  page,
  request,
}) => {
  await configure(request, { delayMs: 1000 });
  await open(page);
  await accept(page);
  await page
    .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Menyimpan…", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("[data-rsvp-mutation-success]")).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: "Dengan senang hati hadir" }),
  ).toBeDisabled();
  await page.getByRole("form", { name: "RSVP Anda" }).evaluate((element) => {
    element.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("Konfirmasi kehadiran Anda telah tersimpan.");
  expect(await submissions(request)).toHaveLength(1);
});

for (const status of ["ACCEPTED", "DECLINED"] as const) {
  test(`hero RSVP link opens the saved ${status} view without submitting`, async ({
    page,
    request,
  }) => {
    await configure(request, {
      rsvp:
        status === "ACCEPTED"
          ? accepted
          : { ...accepted, status, partyMode: undefined },
    });
    await open(page);
    const confirmation = page.getByRole("region", {
      name: "Konfirmasi RSVP Anda",
    });
    await expect(confirmation).toBeVisible();
    const stateBefore = await request.get(`${MOCK}/__rsvp-state`);
    const { reads } = await stateBefore.json();
    const action = heroAction(
      page,
      status === "ACCEPTED" ? "Lihat QR Check-in" : "Lihat Jawaban RSVP",
    );
    const target =
      status === "ACCEPTED" ? "checkin-pass-title" : "rsvp-response-title";
    await expect(action).toHaveAttribute("href", `#${target}`);
    const heading = page.getByRole("heading", {
      name: status === "ACCEPTED" ? "QR Check-in Anda" : "Tidak Hadir",
    });
    if (status === "ACCEPTED") {
      await action.focus();
      await page.keyboard.press("Enter");
      await expectPass(page, firstPass);
    } else {
      await action.click();
      await expectPass(page, null);
    }
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(heading).toHaveCSS("outline-style", "solid");
    expect(new URL(page.url()).hash).toBe("");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(
      status === "ACCEPTED" ? "Kehadiran Terkonfirmasi" : "Tidak Hadir",
    );
    await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    const stateAfter = await request.get(`${MOCK}/__rsvp-state`);
    expect(await stateAfter.json()).toMatchObject({ reads, requests: [] });
  });
}

test("hero RSVP link drops stale QR after failed revalidation and pass revocation", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted });
  await open(page);
  await expect(heroAction(page, "Lihat QR Check-in")).toBeVisible();
  await configure(request, {
    failure: { status: 503, code: "UNEXPECTED", method: "GET" },
  });
  await page.getByRole("button", { name: "Ubah RSVP" }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("belum bisa dimuat");
  await expect(heroAction(page, "Lihat RSVP")).toBeVisible();
  await expectPass(page, null);

  await configure(request, {
    checkinPass: null,
    editBlockedReason: "CHECKED_IN",
  });
  await page.getByRole("button", { name: "Muat Ulang RSVP" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "sudah check-in" }),
  ).toBeVisible();
  await expect(heroAction(page, "Lihat RSVP")).toHaveAttribute(
    "href",
    "#rsvp-title",
  );
  await expect(heroAction(page, "Lihat QR Check-in")).toHaveCount(0);
  await expectPass(page, null);
  await expect(page.getByRole("button", { name: "Ubah RSVP" })).toHaveCount(0);
  expect(await submissions(request)).toHaveLength(0);
});

test.describe("QR shortcut on a narrow touch viewport", () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });
  test("hero RSVP link jumps straight to the existing pass with reduced motion", async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await configure(request, { rsvp: accepted });
    await open(page);
    const action = heroAction(page, "Lihat QR Check-in");
    await expect(action).toBeInViewport({ ratio: 1 });
    await action.tap();
    const heading = page.getByRole("heading", { name: "QR Check-in Anda" });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(heading).toHaveCSS("outline-style", "solid");
    await expectPass(page, firstPass);
  });
});

test("loads accepted state and keeps its draft on a version conflict", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: accepted,
    failure: { status: 409, code: "RSVP_VERSION_CONFLICT", method: "PATCH" },
  });
  await open(page);
  await editSaved(page);
  await expect(
    page.getByRole("radio", { name: "Dengan senang hati hadir" }),
  ).toBeChecked();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expect(
    page.getByRole("radio", { name: "Holy Matrimony Test", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", {
      name: "Saya hadir bersama pendamping",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
    .click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("diperbarui setelah Anda membuka");
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  expect((await submissions(request))[0]!.expectedVersion).toBe(7);
  await expect(
    page.getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ }),
  ).toBeDisabled();
});

test("declined initial state hides stale values and respects companion permissions", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: { ...accepted, status: "DECLINED", partyMode: undefined },
    rules: { allowPlusOne: false, maxAdditionalChildren: 0 },
  });
  await open(page);
  await editSaved(page);
  await expect(
    page.getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" }),
  ).toBeChecked();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "Dengan senang hati hadir" }).check();
  await page
    .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
    .check();
  await expect(
    page.getByRole("radio", {
      name: "Saya hadir bersama pendamping",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: "Saya hadir sendiri", exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveCount(0);
});

test("initial GET failure never enables a create-only form", async ({
  page,
  request,
}) => {
  await configure(request, {
    failure: { status: 404, code: "INVITATION_NOT_AVAILABLE", method: "GET" },
  });
  await open(page);
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("Undangan ini sudah tidak tersedia.");
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
  expect(await submissions(request)).toHaveLength(0);
});

test("attendance and event choices are keyboard operable with visible focus", async ({
  page,
}) => {
  await open(page);
  const choice = page.getByRole("radio", { name: "Dengan senang hati hadir" });
  await choice.focus();
  await page.keyboard.press("Space");
  await expect(choice).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" }),
  ).toBeChecked();
  await expect(choice).not.toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Tab");
  const event = page.getByRole("radio", {
    name: "Holy Matrimony Test",
    exact: true,
  });
  await expect(event).toBeFocused();
  await page.keyboard.press("Space");
  await expect(event).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Saya hadir sendiri", exact: true }),
  ).toBeVisible();
  expect(
    await event.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
});

test("conflict reload adopts a saved decline and removes the previous pass", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted });
  await open(page);
  await editSaved(page);
  await expectPass(page, null);
  await page.locator(".public-rsvp-form").getByRole("textbox").fill("My draft");
  await configure(request, {
    rsvp: {
      ...accepted,
      partyMode: undefined,
      status: "DECLINED",
      version: 8,
      dietaryNotes: null,
      attendees: [],
      eventSelections: [],
      attendeeQuantityTotal: 0,
    },
  });
  await page
    .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
    .click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("My draft");
  await expectPass(page, null);
  await expect(heroAction(page, "Lihat RSVP")).toBeVisible();
  await page.getByRole("button", { name: "Muat Ulang RSVP" }).click();
  await expect(
    page.getByRole("heading", { name: "Tidak Hadir", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("Jawaban RSVP terbaru sudah dimuat");
  await expectPass(page, null);
  await expect(heroAction(page, "Lihat Jawaban RSVP")).toBeVisible();
  expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
    false,
  );
});

test("an uncertain first acceptance never invents a pass before explicit recovery", async ({
  page,
  request,
}) => {
  await configure(request, { dropResponse: true });
  await open(page);
  await accept(page);
  await page.getByRole("button", { name: "Kirim RSVP", exact: true }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("alert"),
  ).toContainText("belum dapat memastikan apakah");
  await expect(page.locator("[data-rsvp-mutation-success]")).toHaveCount(0);
  await expectPass(page, null);
  await expect(heroAction(page, "Lihat RSVP")).toBeVisible();
  await configure(request, {});
  await page.getByRole("button", { name: "Muat Ulang RSVP" }).click();
  await expectPass(page, firstPass);
  await expect(heroAction(page, "Lihat QR Check-in")).toBeVisible();
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([null]);
});

for (const width of [320, 375, 412]) {
  test(`saved RSVP opens read-only and Cancel performs no mutation at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(request, { rsvp: accepted });
    await open(page);
    await expect(
      page.getByRole("heading", {
        name: "Kehadiran Terkonfirmasi",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    await editSaved(page);
    await page
      .getByLabel("Kebutuhan dan preferensi makanan (opsional)")
      .fill("Unsaved draft");
    await page.getByRole("button", { name: "Batal", exact: true }).click();
    await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    await expect(page.locator(".public-rsvp-form")).toContainText("No seafood");
    await expect(page.locator(".public-rsvp-form")).not.toContainText(
      "Unsaved draft",
    );
    expect(await submissions(request)).toHaveLength(0);
    await open(page);
    await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const reason of ["DEADLINE_PASSED", "CHECKED_IN"] as const) {
  test(`saved confirmation respects server editing restriction ${reason}`, async ({
    page,
    request,
  }) => {
    await configure(request, { rsvp: accepted, editBlockedReason: reason });
    await open(page);
    await expect(
      page.getByRole("heading", {
        name: "Kehadiran Terkonfirmasi",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ubah RSVP", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    await expectPass(page, firstPass);
    await expect(heroAction(page, "Lihat QR Check-in")).toBeVisible();
    expect(await submissions(request)).toHaveLength(0);
  });
}

function stickyAction(page: Page) {
  return page.locator(".invitation-sticky-rsvp").getByRole("link");
}

async function browsePastHero(page: Page) {
  await page
    .locator("#couple-title")
    .evaluate((heading) =>
      heading.scrollIntoView({ block: "start", behavior: "instant" }),
    );
}

async function expectStickyAction(page: Page, label: string, target: string) {
  const action = stickyAction(page);
  const hero = heroAction(page, label);
  await expect(action).toHaveAccessibleName(label);
  await expect(action).toHaveAttribute("href", `#${target}`);
  await expect(hero).toHaveAttribute("href", `#${target}`);
  await expect(action).toBeInViewport({ ratio: 1 });
  return action;
}

async function expectRsvpTraffic(
  request: APIRequestContext,
  reads: number,
  mutations = 0,
) {
  const response = await request.get(`${MOCK}/__rsvp-state`);
  const state = await response.json();
  expect(state.reads).toBe(reads);
  expect(state.requests).toHaveLength(mutations);
}

for (const width of [320, 375, 412]) {
  test(`sticky RSVP shortcut clears the form and fits a ${width}px viewport`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(PATH);
    await expect(page.locator(".invitation-sticky-rsvp")).toHaveCount(0);
    await page.getByRole("button", { name: "Buka Undangan" }).click();
    const hero = heroAction(page, "Konfirmasi Kehadiran");
    await expect(hero).toBeVisible();
    await expect(stickyAction(page)).toBeHidden();

    await hero.focus();
    await browsePastHero(page);
    const action = await expectStickyAction(
      page,
      "Konfirmasi Kehadiran",
      "rsvp-title",
    );
    const box = (await action.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
    expect(
      await action.evaluate((link) => link.scrollWidth),
    ).toBeLessThanOrEqual(await action.evaluate((link) => link.clientWidth));
    await page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    await expect(action).toHaveCSS("outline-style", "solid");

    // Scrolling back across the threshold must not drop keyboard focus.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".invitation-sticky-rsvp")).not.toHaveAttribute(
      "data-visible",
      "true",
    );
    await expect(action).toBeFocused();
    await page.keyboard.press("Enter");
    const heading = page.locator("#rsvp-title");
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(stickyAction(page)).toBeHidden();

    await page
      .getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" })
      .check();
    const submit = page.getByRole("button", { name: "Kirim RSVP" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(stickyAction(page)).toBeHidden();
    await expect(heroAction(page, "Konfirmasi Kehadiran")).toBeVisible();
    await expectRsvpTraffic(request, 1);

    await submit.click();
    await expect(heroAction(page, "Lihat Jawaban RSVP")).toBeVisible();
    await browsePastHero(page);
    await expectStickyAction(page, "Lihat Jawaban RSVP", "rsvp-response-title");
    await expectRsvpTraffic(request, 1, 1);
  });
}

test("sticky RSVP shortcut responds to viewport changes, zoom and the message form", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  await open(page);
  await browsePastHero(page);
  await expectStickyAction(page, "Konfirmasi Kehadiran", "rsvp-title");

  for (const size of [
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await browsePastHero(page);
    await expect(stickyAction(page)).toBeHidden();
    await expect(heroAction(page, "Konfirmasi Kehadiran")).toBeVisible();
  }

  await page.setViewportSize({ width: 375, height: 640 });
  await browsePastHero(page);
  await expectStickyAction(page, "Konfirmasi Kehadiran", "rsvp-title");

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await expect(stickyAction(page)).toBeHidden();
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await expectStickyAction(page, "Konfirmasi Kehadiran", "rsvp-title");

  const message = page.getByRole("textbox", { name: /Ucapan Anda/ });
  await message.focus();
  await expect(message).toBeFocused();
  await expect(stickyAction(page)).toBeHidden();
  await message.fill("Synthetic message draft.");
  await expect(message).toHaveValue("Synthetic message draft.");
  await browsePastHero(page);
  await expect(message).toBeFocused();
  await expect(stickyAction(page)).toBeHidden();
  await message.blur();
  await expectStickyAction(page, "Konfirmasi Kehadiran", "rsvp-title");
  await expectRsvpTraffic(request, 1);
});

for (const status of ["ACCEPTED", "DECLINED"] as const) {
  test(`sticky RSVP shortcut opens the saved ${status} view without requests`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 660 });
    await configure(request, {
      rsvp:
        status === "ACCEPTED"
          ? accepted
          : { ...accepted, status, partyMode: undefined },
    });
    await open(page);
    await browsePastHero(page);
    const hasPass = status === "ACCEPTED";
    const target = hasPass ? "checkin-pass-title" : "rsvp-response-title";
    const action = await expectStickyAction(
      page,
      hasPass ? "Lihat QR Check-in" : "Lihat Jawaban RSVP",
      target,
    );
    await action.click();
    await expect(page.locator(`#${target}`)).toBeFocused();
    await expect(page.locator(`#${target}`)).toBeInViewport({ ratio: 1 });
    await expect(stickyAction(page)).toBeHidden();
    await expectPass(page, hasPass ? firstPass : null);
    await expect(page.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    await expectRsvpTraffic(request, 1);
  });
}

test("sticky RSVP shortcut hides stale QR after failed recovery and revocation", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  await configure(request, { rsvp: accepted });
  await open(page);
  await browsePastHero(page);
  await expectStickyAction(page, "Lihat QR Check-in", "checkin-pass-title");

  await configure(request, {
    failure: { status: 503, code: "UNEXPECTED", method: "GET" },
  });
  await page.getByRole("button", { name: "Ubah RSVP" }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("belum bisa dimuat");
  await browsePastHero(page);
  await expect(
    page.getByText("Status QR check-in belum terverifikasi.", { exact: false }),
  ).toBeVisible();
  const fallback = await expectStickyAction(page, "Lihat RSVP", "rsvp-title");
  await fallback.click();
  await expect(page.locator("#rsvp-title")).toBeFocused();
  await expectPass(page, null);
  await expectRsvpTraffic(request, 2);

  await configure(request, {
    checkinPass: null,
    editBlockedReason: "CHECKED_IN",
  });
  await page.getByRole("button", { name: "Muat Ulang RSVP" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "sudah check-in" }),
  ).toBeVisible();
  await browsePastHero(page);
  await expectStickyAction(page, "Lihat RSVP", "rsvp-title");
  await expectPass(page, null);
  await expect(
    page.getByText("QR check-in saat ini tidak tersedia.", { exact: false }),
  ).toBeVisible();
  await expectRsvpTraffic(request, 3);
});

test("sticky RSVP shortcut disconnects when observing a section fails", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PATH);
  const openInvitation = page.getByRole("button", { name: "Buka Undangan" });
  await expect(openInvitation).toBeEnabled();

  await page.evaluate(() => {
    const BrowserObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends BrowserObserver {
      private sticky = false;

      override observe(target: Element) {
        if (this.sticky) throw new Error("Synthetic sticky observe failure");
        this.sticky = target.matches(".invitation-hero");
        super.observe(target);
      }

      override disconnect() {
        if (this.sticky)
          Reflect.set(window, "stickyObserverDisconnected", true);
        super.disconnect();
      }
    };
  });

  await openInvitation.press("Enter");
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "stickyObserverDisconnected")),
    )
    .toBe(true);
  await browsePastHero(page);
  await expect(stickyAction(page)).toBeHidden();

  await heroAction(page, "Konfirmasi Kehadiran").press("Enter");
  await expect(page.locator("#rsvp-title")).toBeFocused();
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toBeVisible();
  await expectRsvpTraffic(request, 1);
});
