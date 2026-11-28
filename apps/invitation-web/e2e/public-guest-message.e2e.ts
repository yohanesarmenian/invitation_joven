import { MOCK_API_ORIGIN } from "./harness";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { SubmitPublicGuestMessageRequest } from "../../../packages/api-client/src/index";

const MOCK = MOCK_API_ORIGIN;
const PATH = `/i/${"A".repeat(43)}`;
const section = (page: Page) => page.locator(".guest-message-section");
const form = (page: Page) =>
  section(page).getByRole("form", { name: "Ucapan untuk mempelai" });
const author = (page: Page) =>
  section(page).getByRole("textbox", { name: "Nama Anda (opsional)" });
const message = (page: Page) =>
  section(page).getByRole("textbox", { name: "Ucapan Anda (wajib)" });
const send = (page: Page) =>
  section(page).getByRole("button", { name: "Kirim Ucapan", exact: true });
const errors = new WeakMap<Page, string[]>();
const accepted = {
  status: "ACCEPTED",
  version: 7,
  dietaryNotes: "No seafood",
  attendeeQuantityTotal: 1,
  attendees: [
    { type: "NAMED_INVITEE", inviteeId: "invitee-test-1", quantity: 1 },
  ],
  eventSelections: [
    { eventId: "event-test-1", attending: true, expectedAttendeeCount: 1 },
  ],
};

async function configure(request: APIRequestContext, data: unknown) {
  expect((await request.post(`${MOCK}/__message-fixture`, { data })).ok()).toBe(
    true,
  );
}
async function state(
  request: APIRequestContext,
): Promise<{ requests: SubmitPublicGuestMessageRequest[]; commits: number }> {
  return await (await request.get(`${MOCK}/__message-state`)).json();
}
async function open(page: Page) {
  await page.goto(PATH);
  await page.getByRole("button", { name: "Buka Undangan" }).click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(form(page)).toBeVisible();
}
async function success(page: Page) {
  await expect(
    section(page).getByRole("heading", {
      name: "Terima kasih atas ucapan Anda",
    }),
  ).toBeFocused();
  await expect(section(page).getByRole("status")).toContainText(
    "Ucapan Anda telah tersimpan",
  );
  await expect(form(page)).toHaveCount(0);
  await expect(
    section(page).locator("input, textarea, ul, ol, time"),
  ).toHaveCount(0);
  await expect(
    section(page).getByRole("button", { name: "Kembali ke Undangan" }),
  ).toBeVisible();
}
async function layout(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await section(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      clipped: [
        ...element.querySelectorAll("input, textarea, button, p, h3, label"),
      ].some((item) => {
        const rect = item.getBoundingClientRect();
        return (
          rect.left < box.left ||
          rect.right > box.right ||
          item.scrollWidth > item.clientWidth + 1
        );
      }),
      smallTargets: [
        ...element.querySelectorAll("input, textarea, button"),
      ].some((item) => item.getBoundingClientRect().height < 44),
    };
  });
  expect(geometry).toEqual({ clipped: false, smallTargets: false });
  await section(page).screenshot({
    path: info.outputPath(`${name}.png`),
    animations: "disabled",
    style: "nextjs-portal { visibility: hidden; }",
  });
}

test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${MOCK}/__reset`)).status()).toBe(204);
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error") messages.push(entry.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(new URL(page.url()).pathname).toBe(PATH);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  expect(
    await page.evaluate(() => ({
      receiptOnly:
        localStorage.length <= 1 &&
        Object.entries(localStorage).every(
          ([key, value]) =>
            /^guest-message:[0-9a-f]{64}$/.test(key) &&
            /^[0-9a-f-]{36}$/.test(value),
        ),
      session: sessionStorage.length,
      cookies: document.cookie,
      overflow: document.documentElement.scrollWidth > innerWidth,
    })),
  ).toEqual({ receiptOnly: true, session: 0, cookies: "", overflow: false });
});

for (const width of [320, 375, 412, 768, 1280]) {
  test(`named multiline message, pending, back and anonymous second message at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(request, { delayMs: 800 });
    await open(page);
    await expect(author(page)).toHaveValue("");
    await send(page).click();
    await expect(message(page)).toBeFocused();
    await expect(message(page)).toHaveAttribute("aria-invalid", "true");
    await expect(section(page).getByRole("alert")).toContainText(
      "Silakan tulis ucapan",
    );
    expect((await state(request)).requests).toHaveLength(0);
    await layout(page, info, `message-error-${width}`);
    await author(page).fill("  Jo  ");
    await message(page).fill("  Congratulations!\n\nGod bless you both!  ");
    await layout(page, info, `message-form-${width}`);
    await send(page).focus();
    await page.keyboard.press("Enter");
    await expect(
      section(page).getByRole("button", { name: "Mengirim…", exact: true }),
    ).toBeDisabled();
    await expect(section(page).getByRole("status")).toHaveText(
      "Mengirim ucapan Anda…",
    );
    await expect(message(page)).toHaveValue(
      "  Congratulations!\n\nGod bless you both!  ",
    );
    await expect(message(page)).toBeDisabled();
    await form(page).evaluate((element) => {
      for (let i = 0; i < 2; i++)
        element.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await success(page);
    expect((await state(request)).requests).toEqual([
      {
        authorName: "Jo",
        message: "Congratulations!\n\nGod bless you both!",
        submissionId: expect.any(String),
      },
    ]);
    await layout(page, info, `message-sent-${width}`);
    const back = section(page).getByRole("button", {
      name: "Kembali ke Undangan",
    });
    await back.focus();
    expect(
      await back.evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(page.locator("#invitation-hero-title")).toBeFocused();
    await expect(form(page)).toHaveCount(0);
    await section(page)
      .getByRole("button", { name: "Tulis Ucapan Lain" })
      .click();
    await expect(author(page)).toBeFocused();
    await expect(author(page)).toHaveValue("");
    await expect(message(page)).toHaveValue("");
    await expect(
      section(page).getByRole("heading", {
        name: "Terima kasih atas ucapan Anda",
      }),
    ).toHaveCount(0);
    await configure(request, {});
    await send(page).click();
    await expect(message(page)).toBeFocused();
    await message(page).fill("Wishing you every happiness 💐");
    await expect(message(page)).toBeFocused();
    await send(page).click();
    await success(page);
    expect((await state(request)).requests[1]).toEqual({
      authorName: null,
      message: "Wishing you every happiness 💐",
      submissionId: expect.any(String),
    });
    expect((await state(request)).commits).toBe(2);
    await expect(section(page)).not.toContainText("Congratulations!");
  });
}

test("Unicode boundaries block invalid submissions and allow exact normalized limits", async ({
  page,
  request,
}) => {
  await open(page);
  for (const value of [
    "",
    "   ",
    "\n\n",
    "x".repeat(1001),
    "💐".repeat(1001),
  ]) {
    await message(page).fill(value);
    await send(page).click();
    await expect(message(page)).toHaveAttribute("aria-invalid", "true");
    expect((await state(request)).requests).toHaveLength(0);
  }
  await message(page).fill("  " + "💐".repeat(1000) + "  ");
  await expect(
    section(page).getByText("1.000 / 1.000 karakter", { exact: false }),
  ).toBeVisible();
  for (const value of ["x".repeat(101), "💐".repeat(101)]) {
    await author(page).fill(value);
    await send(page).click();
    await expect(author(page)).toBeFocused();
    await expect(author(page)).toHaveAttribute(
      "aria-describedby",
      /author-error/,
    );
    expect((await state(request)).requests).toHaveLength(0);
  }
  await author(page).fill(" " + "💐".repeat(100) + " ");
  await send(page).click();
  await success(page);
  const submitted = (await state(request)).requests[0]!;
  expect([...(submitted.authorName ?? "")]).toHaveLength(100);
  expect([...submitted.message]).toHaveLength(1000);
});

for (const [status, code, text] of [
  [400, "VALIDATION_ERROR", "Periksa nama dan isi ucapan Anda"],
  [404, "INVITATION_NOT_AVAILABLE", "Undangan sedang tidak tersedia"],
] as const) {
  test(`known ${status} failure preserves the draft until explicit retry`, async ({
    page,
    request,
  }) => {
    await configure(request, { failure: { status, code } });
    await open(page);
    await author(page).fill("Test Author");
    await message(page).fill("Keep these wishes");
    await send(page).click();
    await expect(section(page).getByRole("alert")).toContainText(text);
    await expect(section(page).getByRole("alert")).toBeFocused();
    await expect(author(page)).toHaveValue("Test Author");
    await expect(message(page)).toHaveValue("Keep these wishes");
    await expect(
      section(page).getByRole("heading", {
        name: "Terima kasih atas ucapan Anda",
      }),
    ).toHaveCount(0);
    // Allow a bounded observation interval to detect unintended automatic retry.
    await page.waitForTimeout(300);
    expect((await state(request)).requests).toHaveLength(1);
    await configure(request, {});
    await section(page)
      .getByRole("button", { name: "Coba Kirim Ucapan Lagi" })
      .click();
    await success(page);
    expect((await state(request)).requests).toHaveLength(2);
  });
}

for (const mode of ["dropResponse", "malformed"]) {
  test(`${mode} preserves an uncertain draft and retries the same submission explicitly`, async ({
    page,
    request,
  }) => {
    await configure(request, { [mode]: true });
    await open(page);
    await message(page).fill("An uncertain wish");
    await send(page).click();
    await expect(section(page).getByRole("alert")).toContainText(
      "Kami belum dapat memastikan apakah ucapan Anda tersimpan",
    );
    await expect(message(page)).toHaveValue("An uncertain wish");
    await expect(
      section(page).getByRole("heading", {
        name: "Terima kasih atas ucapan Anda",
      }),
    ).toHaveCount(0);
    await page.waitForTimeout(300);
    expect((await state(request)).requests).toHaveLength(1);
    expect((await state(request)).commits).toBe(1);
    await configure(request, {});
    await section(page)
      .getByRole("button", { name: "Kirim Ulang Ucapan yang Sama" })
      .click();
    await success(page);
    const after = await state(request);
    expect(after.commits).toBe(1);
    expect(after.requests[0]).toEqual(after.requests[1]);
  });
}

for (const mode of ["accepted", "declined", "deadline"]) {
  test(`message submission is independent of ${mode} RSVP state`, async ({
    page,
    request,
  }) => {
    await request.post(`${MOCK}/__rsvp-fixture`, {
      data: {
        rsvp:
          mode === "declined"
            ? {
                ...accepted,
                status: "DECLINED",
                attendees: [],
                eventSelections: [],
                attendeeQuantityTotal: 0,
                dietaryNotes: null,
              }
            : accepted,
        ...(mode === "deadline"
          ? {
              deadline: "2020-01-01T00:00:00Z",
              editBlockedReason: "DEADLINE_PASSED",
              failure: {
                status: 422,
                code: "RSVP_DEADLINE_PASSED",
                method: "PUT",
              },
            }
          : {}),
      },
    });
    await open(page);
    const rsvp = page.locator(".public-rsvp-form");
    const arrival = rsvp.getByText(
      "Silakan tunjukkan undangan ini kepada penerima tamu saat tiba di lokasi acara.",
      { exact: true },
    );
    await expect(rsvp.locator(".guest-checkin-pass")).toHaveCount(0);
    const draft = rsvp.getByRole("textbox");
    if (mode === "accepted") {
      await expect(arrival).toBeVisible();
      await rsvp
        .getByRole("button", { name: "Ubah RSVP", exact: true })
        .click();
      await draft.fill("Unsaved RSVP draft");
      await expect(arrival).toHaveCount(0);
    }
    if (mode === "deadline") {
      await expect(
        rsvp
          .getByRole("status")
          .filter({ hasText: "Waktu untuk mengubah RSVP sudah berakhir" }),
      ).toBeVisible();
      await expect(
        rsvp.getByRole("button", { name: "Ubah RSVP", exact: true }),
      ).toHaveCount(0);
    }
    const before = await rsvp.innerHTML();
    const apiBefore = await (await request.get(`${MOCK}/__rsvp-state`)).json();
    await message(page).fill("Always wishing you joy");
    await send(page).click();
    await success(page);
    expect(await state(request)).toEqual({
      commits: 1,
      requests: [
        {
          authorName: null,
          message: "Always wishing you joy",
          submissionId: expect.any(String),
        },
      ],
    });
    expect((await rsvp.innerHTML()) === before).toBe(true);
    expect(await (await request.get(`${MOCK}/__rsvp-state`)).json()).toEqual(
      apiBefore,
    );
    if (mode === "accepted") {
      await expect(draft).toHaveValue("Unsaved RSVP draft");
      await expect(arrival).toHaveCount(0);
      await rsvp.getByRole("button", { name: "Batal", exact: true }).click();
      await expect(arrival).toBeVisible();
    } else if (mode === "declined") {
      await expect(arrival).toHaveCount(0);
    } else {
      await expect(arrival).toBeVisible();
    }
  });
}

test("script-like and Markdown content stays plain text and is never echoed publicly", async ({
  page,
  request,
}) => {
  await open(page);
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  const plain =
    '<script>alert("x")</script>\n<img src=x onerror=alert("x")>\n**Love**';
  await author(page).fill("<b>Anonymous</b>");
  await message(page).fill(plain);
  await expect(section(page).locator("script, img, b")).toHaveCount(0);
  await send(page).click();
  await success(page);
  expect((await state(request)).requests[0]).toEqual({
    authorName: "<b>Anonymous</b>",
    message: plain,
    submissionId: expect.any(String),
  });
  expect(dialogs).toBe(0);
  await expect(section(page)).not.toContainText(plain);
  await expect(section(page).locator("script, b")).toHaveCount(0);
  // Only the fixed local Figma confirmation icon may render after success.
  const icon = section(page).locator("img");
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute(
    "src",
    "/assets/figma/82-113-imgLoveLetterIcon.svg",
  );
  await expect(icon).not.toHaveAttribute("onerror");
});
