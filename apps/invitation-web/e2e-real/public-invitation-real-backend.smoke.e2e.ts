import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  readSmokeState,
  runFixtureCli,
  type SmokeFixtureRead,
  type SmokeMessageState,
  type SmokePassState,
} from "./smoke-fixture";

// Internal fields that must never reach the browser. `publicTokenHash` and
// `tokenHash` in particular would let the raw credential be recovered by brute
// force offline, and `credentialVersion` is explicitly non-public per the
// "Public IDs" section of docs/API-CONTRACT.md.
const LEAKED_INTERNAL_FIELDS = [
  "publicTokenHash",
  "publicTokenVersion",
  "tokenHash",
  "credentialVersion",
  "firstOpenedAt",
  "lastOpenedAt",
  "openCount",
  "open_count",
];

// The compiled Nest API started by `playwright.real.config.ts`. Reached
// directly so the browser-rendered pass can be compared against the real
// canonical response without going through the Next server.
const REAL_API_BASE_URL = "http://127.0.0.1:4000";

const ARRIVAL =
  "Silakan tunjukkan undangan ini kepada penerima tamu saat tiba di lokasi acara.";

/**
 * Compares two secret values without ever placing them in an assertion
 * message. `expect(a).toBe(b)` would print both on failure; this prints only
 * `false`.
 */
function sameSecret(a: string, b: string): boolean {
  return a === b;
}

type CanonicalRsvp = {
  checkinPass: {
    issuedAt: string;
    qrPayload: string;
    status: string;
  } | null;
  rsvp: { status: string; version: number } | null;
};

async function fetchCanonicalRsvp(
  publicCredential: string,
): Promise<CanonicalRsvp> {
  const response = await fetch(
    `${REAL_API_BASE_URL}/api/public/invitations/${publicCredential}/rsvp`,
  );

  expect(response.status).toBe(200);

  return (await response.json()) as CanonicalRsvp;
}

async function openInvitation(page: Page, publicCredential: string) {
  await page.goto(`/i/${publicCredential}`);
  await page.getByRole("button", { name: "Buka Undangan" }).click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect(page.locator(".public-rsvp-form")).toBeVisible();
}

async function editSaved(page: Page) {
  await page.getByRole("button", { name: "Ubah RSVP", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Simpan Perubahan", exact: true }),
  ).toBeVisible();
}
async function acceptInBrowser(page: Page) {
  if (
    await page.getByRole("button", { name: "Ubah RSVP", exact: true }).count()
  )
    await editSaved(page);
  await page.getByRole("radio", { name: "Dengan senang hati hadir" }).check();
  await page
    .getByRole("radio", { name: "Saya hadir sendiri", exact: true })
    .check();
  await page
    .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
    .click();
}

function passState(): SmokePassState {
  return runFixtureCli<SmokePassState>("pass-state");
}

function resetRsvp(): void {
  runFixtureCli<{ status: string }>("reset-rsvp");
}

test("real backend: one retrieval per server render, client stages stay local", async ({
  page,
}) => {
  const state = readSmokeState();
  const expectedOpenCount = state.beforeOpenCount + 1;

  await page.goto(`/i/${state.publicCredential}`);

  // Closed state: the invitation was retrieved server-side exactly once for
  // this render, which is what bumps open_count.
  const openButton = page.getByRole("button", { name: "Buka Undangan" });
  await expect(openButton).toBeVisible();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "closed",
  );
  await expect(page.getByRole("heading", { name: "Smoke Guest" })).toBeHidden();

  const afterRender = runFixtureCli<SmokeFixtureRead>("read");
  expect(afterRender.openCount).toBe(expectedOpenCount);
  expect(afterRender.firstOpenedAtPresent).toBe(true);
  expect(afterRender.lastOpenedAtPresent).toBe(true);

  await openButton.click();

  // The single activation starts a local transition without a new server render.
  expect(runFixtureCli<SmokeFixtureRead>("read").openCount).toBe(
    expectedOpenCount,
  );

  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).toBeFocused();

  // Content state: rendered from the single server-side retrieval.
  await expect(
    page.getByRole("heading", { name: "Smoke Guest" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "5C Smoke Ceremony" }),
  ).toBeVisible();
  await expect(page.getByText("5C Smoke Venue")).toBeVisible();
  await expect(page.getByText("1 Smoke Test Lane")).toBeVisible();
  expect(runFixtureCli<SmokeFixtureRead>("read").openCount).toBe(
    expectedOpenCount,
  );

  // Privacy: distinguish the identifiers the public contract allows from the
  // ones it forbids (docs/API-CONTRACT.md, "Public IDs"). `state.eventId` is
  // the public `events[].id` and is required in the payload because the browser
  // submits it as `eventSelections[].eventId`, so its presence is asserted
  // rather than rejected. The internal `Invitation.id` is not part of that
  // projection and stays forbidden, as does all hash/version material.
  const html = await page.content();
  const visibleText = await page.locator("body").innerText();

  for (const field of LEAKED_INTERNAL_FIELDS) {
    expect(html).not.toContain(field);
  }

  expect(html).toContain(state.eventId);
  expect(html).not.toContain(state.invitationId);
  expect(visibleText).not.toContain(state.publicCredential);
});

// ---------------------------------------------------------------------------
test("real backend: guests accept, reopen, edit and decline without digital attendance", async ({
  page,
}) => {
  const state = readSmokeState();
  resetRsvp();
  try {
    await page.setViewportSize({ width: 320, height: 720 });
    await openInvitation(page, state.publicCredential);
    await acceptInBrowser(page);
    await expect(page.getByText(ARRIVAL, { exact: true })).toBeVisible();
    await expect(
      page.locator(".guest-checkin-pass, .checkin-code"),
    ).toHaveCount(0);
    expect(await fetchCanonicalRsvp(state.publicCredential)).toMatchObject({
      checkinPass: null,
      rsvp: { status: "ACCEPTED" },
    });
    expect(passState().totalPassCount).toBe(0);

    await openInvitation(page, state.publicCredential);
    await expect(page.getByText(ARRIVAL, { exact: true })).toBeVisible();
    await editSaved(page);
    await page
      .getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" })
      .check();
    await page
      .getByRole("button", { name: "Simpan Perubahan", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Tidak Hadir", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(ARRIVAL, { exact: true })).toHaveCount(0);
    await openInvitation(page, state.publicCredential);
    await expect(
      page.getByRole("heading", { name: "Tidak Hadir", exact: true }),
    ).toBeVisible();
    expect(await fetchCanonicalRsvp(state.publicCredential)).toMatchObject({
      checkinPass: null,
      rsvp: { status: "DECLINED" },
    });
    expect(passState().totalPassCount).toBe(0);
  } finally {
    resetRsvp();
  }
});

const GUEST_MESSAGE_HEADING = "Tulis Ucapan untuk Kedua Mempelai";
const GUEST_MESSAGE_SUCCESS = "Terima kasih atas ucapan Anda";
const GUEST_MESSAGE_FORM = "Ucapan untuk mempelai";

const AUTHOR_WITH_PADDING = "  Smoke Author  ";
const AUTHOR_NORMALIZED = "Smoke Author";
const MESSAGE_WITH_PADDING = "  First line\nSecond line  ";
const MESSAGE_NORMALIZED = "First line\nSecond line";
const SCRIPT_MESSAGE = "<script>window.__xss = 1</script> plain text";
const EMOJI = "😀";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function messageState(): SmokeMessageState {
  return runFixtureCli<SmokeMessageState>("message-state");
}

function resetMessages(): void {
  runFixtureCli<{ status: string }>("reset-messages");
}

function setInvitationStatus(status: "active" | "archived"): void {
  runFixtureCli<{ status: string }>("set-invitation-status", [status]);
}

function resetRsvpAndMessages(): void {
  runFixtureCli<{ status: string }>("reset-rsvp");
  resetMessages();
}

function guestMessageForm(page: Page) {
  return page.getByRole("form", { name: GUEST_MESSAGE_FORM });
}

/** Scoped to the guest-message component so the RSVP notices never match. */
function guestMessageAlert(page: Page) {
  return page.locator(".guest-message-form").getByRole("alert");
}

function sendButton(page: Page) {
  return page.getByRole("button", { name: /^Kirim Ucapan/ });
}

async function openMessageForm(page: Page, publicCredential: string) {
  await openInvitation(page, publicCredential);

  await expect(guestMessageForm(page)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_HEADING }),
  ).toBeVisible();
}

async function fillMessage(
  page: Page,
  authorName: string | null,
  message: string,
): Promise<void> {
  if (authorName !== null) {
    await page.getByLabel(/Nama Anda/).fill(authorName);
  }

  await page.getByLabel(/Ucapan Anda/).fill(message);
}

/**
 * A Next server action arrives as a POST to the page route. The header name is
 * not stable across Next versions, so it is matched case-insensitively instead
 * of by exact spelling.
 */
function isServerActionRequest(request: {
  headers: () => Record<string, string>;
  method: () => string;
}): boolean {
  return (
    request.method() === "POST" &&
    Object.keys(request.headers()).some(
      (header) => header.toLowerCase() === "next-action",
    )
  );
}

test("real backend: the message section renders a real form and no placeholder", async ({
  page,
}) => {
  const state = readSmokeState();

  await openMessageForm(page, state.publicCredential);

  await expect(guestMessageForm(page).locator("textarea")).toHaveCount(1);
  await expect(page.getByLabel(/Nama Anda/)).toBeVisible();
  await expect(sendButton(page)).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toHaveCount(0);

  // No placeholder copy survives, and no public message history is rendered.
  const visibleText = await page.locator("body").innerText();

  expect(/coming soon|later phase|stay tuned/i.test(visibleText)).toBe(false);
  await expect(page.getByText("See you at the Wedding!")).toBeVisible();
});

test("real backend: a named multiline message is persisted and confirmed in the browser", async ({
  page,
}) => {
  const state = readSmokeState();
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_WITH_PADDING, MESSAGE_WITH_PADDING);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();
  await expect(
    page.getByText("Ucapan Anda telah tersimpan untuk kedua mempelai."),
  ).toBeVisible();

  // No route change: the confirmation is an in-place state on the same page.
  expect(new URL(page.url()).pathname).toBe(`/i/${state.publicCredential}`);

  const after = messageState();

  expect(after.messageCount).toBe(1);

  const [row] = after.messages;

  expect(row!.authorNamePresent).toBe(true);
  expect(row!.authorNameIsTrimmed).toBe(true);
  expect(row!.messageIsTrimmed).toBe(true);
  expect(row!.messageHasNewline).toBe(true);
  expect(row!.invitationIdMatches).toBe(true);
  expect(row!.isHidden).toBe(false);
  expect(row!.authorNameSha256).toBe(sha256(AUTHOR_NORMALIZED));
  expect(row!.messageSha256).toBe(sha256(MESSAGE_NORMALIZED));

  expect(pageErrors).toEqual([]);
});

test("real backend: an anonymous message is accepted and stored without an author", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, null, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.authorNamePresent).toBe(false);
});

test("real backend: Back to Invitation keeps the saved receipt and a deliberate second submission appends", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  await page
    .getByRole("region", { name: GUEST_MESSAGE_SUCCESS })
    .getByRole("button", { name: "Kembali ke Undangan", exact: true })
    .click();

  await expect(page.locator("#invitation-hero-title")).toBeFocused();
  await expect(guestMessageForm(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tulis Ucapan Lain" }).click();
  await expect(page.getByLabel(/Nama Anda/)).toHaveValue("");
  await expect(page.getByLabel(/Ucapan Anda/)).toHaveValue("");
  await expect(sendButton(page)).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe(`/i/${state.publicCredential}`);

  // A later explicit submission is a new request, not a locked-out one.
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const after = messageState();

  expect(after.messageCount).toBe(2);
  expect(after.messages[0]!.id).not.toBe(after.messages[1]!.id);
});

test("real backend: client validation blocks invalid content before any request", async ({
  page,
}) => {
  const state = readSmokeState();
  let requests = 0;

  resetMessages();

  page.on("request", (request) => {
    if (isServerActionRequest(request)) requests += 1;
  });

  await openMessageForm(page, state.publicCredential);

  // Blank message.
  await fillMessage(page, AUTHOR_NORMALIZED, "   ");
  await sendButton(page).click();
  await expect(
    guestMessageAlert(page).filter({
      hasText: "Silakan tulis ucapan untuk kedua mempelai.",
    }),
  ).toBeVisible();
  expect(requests).toBe(0);

  // One code point over the message cap.
  await fillMessage(page, AUTHOR_NORMALIZED, EMOJI.repeat(1001));
  await sendButton(page).click();
  await expect(page.getByText(/lebih dari 1\.000 karakter/)).toBeVisible();
  expect(requests).toBe(0);

  // One code point over the author-name cap.
  await fillMessage(page, EMOJI.repeat(101), MESSAGE_NORMALIZED);
  await sendButton(page).click();
  await expect(page.getByText(/lebih dari 100 karakter/)).toBeVisible();
  expect(requests).toBe(0);

  expect(messageState().messageCount).toBe(0);

  // Exactly at both caps is accepted and does reach the server.
  await fillMessage(page, EMOJI.repeat(100), EMOJI.repeat(1000));
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();
  expect(requests).toBe(1);

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.messageCodePoints).toBe(1000);
  expect(after.messages[0]!.authorNameCodePoints).toBe(100);
});

test("real backend: a pending submission is not duplicated by repeated clicks", async ({
  page,
}) => {
  const state = readSmokeState();
  let requests = 0;

  resetMessages();

  page.on("request", (request) => {
    if (isServerActionRequest(request)) requests += 1;
  });

  // Hold the response so the pending window is observable rather than a race.
  await page.route("**/*", async (route) => {
    if (isServerActionRequest(route.request())) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    await route.continue();
  });

  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);

  await sendButton(page).click();

  // The pending state is real, and the control is disabled during it.
  await expect(page.getByRole("button", { name: /^Mengirim/ })).toBeDisabled();
  expect(requests).toBe(1);

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  // One pending activation reaches the server.
  expect(requests).toBe(1);
  expect(messageState().messageCount).toBe(1);
});

test("real backend: a rejected submission keeps the draft and retries explicitly", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);

  try {
    // The invitation closes mid-session, after the page was already rendered.
    setInvitationStatus("archived");
    await sendButton(page).click();

    await expect(
      page.getByText("Undangan sedang tidak tersedia"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
    ).toHaveCount(0);

    // The draft survives the failure; nothing was silently retried.
    await expect(page.getByLabel(/Nama Anda/)).toHaveValue(AUTHOR_NORMALIZED);
    await expect(page.getByLabel(/Ucapan Anda/)).toHaveValue(
      MESSAGE_NORMALIZED,
    );
    expect(messageState().messageCount).toBe(0);
  } finally {
    setInvitationStatus("active");
  }

  // The explicit retry is a new user action and succeeds.
  await page.getByRole("button", { name: "Coba Kirim Ucapan Lagi" }).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.messageSha256).toBe(sha256(MESSAGE_NORMALIZED));
});

test("real backend: a response lost after a committed write never claims success and never auto-retries", async ({
  page,
}) => {
  const state = readSmokeState();
  let requests = 0;

  resetMessages();

  page.on("request", (request) => {
    if (isServerActionRequest(request)) requests += 1;
  });

  // The request is performed for real — so the append commits — and only then
  // is the browser's response dropped. This is the exact uncertain case: the
  // guest cannot tell whether the message was saved.
  await page.route("**/*", async (route) => {
    if (!isServerActionRequest(route.request())) {
      await route.continue();
      return;
    }

    await route.fetch();
    await route.abort("failed");
  });

  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByText(
      "Kami belum dapat memastikan apakah ucapan Anda tersimpan.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toHaveCount(0);

  // Draft preserved, no automatic retry, and the result is genuinely unknown.
  await expect(page.getByLabel(/Ucapan Anda/)).toHaveValue(MESSAGE_NORMALIZED);
  expect(requests).toBe(1);

  // The write committed. Recover with the same submission ID.
  expect(messageState().messageCount).toBe(1);
  await page.unroute("**/*");
  await page
    .getByRole("button", { name: "Kirim Ulang Ucapan yang Sama" })
    .click();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();
  expect(messageState().messageCount).toBe(1);
});

test("real backend: guest messages stay available after a decline and past the RSVP deadline", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvpAndMessages();

  await openMessageForm(page, state.publicCredential);
  await page
    .getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" })
    .check();
  await page
    .getByRole("button", { name: /^(Kirim RSVP|Simpan Perubahan)$/ })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Terima kasih telah memberi kabar" }),
  ).toBeVisible();

  expect(passState().rsvpStatus).toBe("DECLINED");

  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  // The message write did not disturb the RSVP it is independent of.
  expect(passState().rsvpStatus).toBe("DECLINED");

  // Re-accept so a reloaded form is in the editable ACCEPTED shape; a declined
  // RSVP renders a summary without the dietary field, which is not what this
  // leg is measuring.
  await acceptInBrowser(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Terima kasih atas konfirmasi Anda" }),
  ).toBeVisible();

  runFixtureCli<{ status: string }>("set-deadline", ["past"]);

  try {
    // A fresh load past the cutoff. The RSVP controls are still closed...
    await openInvitation(page, state.publicCredential);
    await page.getByRole("button", { name: "Tulis Ucapan Lain" }).click();
    await expect(guestMessageForm(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ubah RSVP", exact: true }),
    ).toHaveCount(0);
    const denied = await fetch(
      `${REAL_API_BASE_URL}/api/public/invitations/${state.publicCredential}/rsvp`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "DECLINED",
          expectedVersion: 1,
          attendees: [],
          eventSelections: [],
          dietaryNotes: null,
        }),
      },
    );
    expect(denied.status).toBe(422);
    expect((await denied.json()).error.code).toBe("RSVP_DEADLINE_PASSED");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Waktu untuk mengubah RSVP sudah berakhir" }),
    ).toBeVisible();

    // ...and the guest message path is not.
    await fillMessage(page, null, MESSAGE_NORMALIZED);
    await sendButton(page).click();

    await expect(
      page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
    ).toBeVisible();
  } finally {
    runFixtureCli<{ status: string }>("set-deadline", ["none"]);
  }

  expect(messageState().messageCount).toBe(2);

  resetRsvpAndMessages();
});

test("real backend: a guest message leaves the saved RSVP unchanged", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvpAndMessages();

  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);

  await expect(page.getByText(ARRIVAL, { exact: true })).toBeVisible();
  const before = passState();

  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  await expect(page.getByText(ARRIVAL, { exact: true })).toBeVisible();
  expect(passState()).toEqual(before);
  expect(before.totalPassCount).toBe(0);

  resetRsvpAndMessages();
});

test("real backend: script-like message content never executes and never renders", async ({
  page,
}) => {
  const state = readSmokeState();
  const dialogs: string[] = [];
  const pageErrors: string[] = [];

  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, SCRIPT_MESSAGE);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const xss = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__xss ?? null,
  );

  expect(xss).toBe(null);
  expect(dialogs).toEqual([]);
  expect(pageErrors).toEqual([]);

  // Stored verbatim, never interpreted, and never rendered back to the public.
  const html = await page.content();

  expect(html.includes(SCRIPT_MESSAGE)).toBe(false);
  expect(html.includes("__xss")).toBe(false);

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.messageSha256).toBe(sha256(SCRIPT_MESSAGE));

  resetMessages();
});

test("real backend: guest content stays out of storage, URLs, and third-party requests", async ({
  page,
}) => {
  const state = readSmokeState();
  const requests: string[] = [];
  const consoleOutput: string[] = [];
  const pageErrors: string[] = [];

  resetMessages();

  page.on("request", (request) => {
    requests.push(`${request.method()} ${request.url()}`);
  });
  page.on("console", (message) => {
    consoleOutput.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const secrets = [AUTHOR_NORMALIZED, MESSAGE_NORMALIZED];

  // Guest content never reaches a URL, encoded or raw.
  for (const entry of requests) {
    for (const value of secrets) {
      expect(entry.includes(encodeURIComponent(value))).toBe(false);
      expect(entry.includes(value)).toBe(false);
    }
  }

  // No third-party destination of any kind is contacted.
  expect(requests.filter((entry) => !entry.includes("localhost:3000"))).toEqual(
    [],
  );

  const stored = await page.evaluate(() => ({
    cookie: document.cookie,
    localStorage: JSON.stringify(window.localStorage),
    sessionStorage: JSON.stringify(window.sessionStorage),
  }));

  for (const value of secrets) {
    expect(stored.localStorage.includes(value)).toBe(false);
    expect(stored.sessionStorage.includes(value)).toBe(false);
    expect(stored.cookie.includes(value)).toBe(false);
  }

  // No content in the URL, and the credential route is unchanged.
  const url = new URL(page.url());

  expect(sameSecret(url.pathname, `/i/${state.publicCredential}`)).toBe(true);
  expect(url.search).toBe("");
  expect(url.hash).toBe("");

  for (const line of [...consoleOutput, ...pageErrors]) {
    for (const value of secrets) {
      expect(line.includes(value)).toBe(false);
    }
  }

  expect(pageErrors).toEqual([]);

  resetMessages();
});

test("real backend: the message form and confirmation fit every supported viewport", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);

  for (const width of [320, 375, 412, 768, 1280]) {
    await page.setViewportSize({ height: 900, width });

    await expect(
      page.getByRole("heading", { name: GUEST_MESSAGE_HEADING }),
    ).toBeVisible();
    await expect(page.getByLabel(/Nama Anda/)).toBeVisible();
    await expect(guestMessageForm(page).locator("textarea")).toBeVisible();
    await expect(sendButton(page)).toBeEnabled();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);

    const field = await page.getByLabel(/Ucapan Anda/).boundingBox();

    expect(field).not.toBeNull();
    expect(field!.x).toBeGreaterThanOrEqual(0);
    expect(field!.x + field!.width).toBeLessThanOrEqual(width + 1);
  }

  // The confirmation state also fits the narrowest supported width.
  await page.setViewportSize({ height: 900, width: 320 });
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  const success = page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS });

  await expect(success).toBeVisible();

  const box = await success.boundingBox();

  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  await expect(
    page
      .getByRole("region", { name: GUEST_MESSAGE_SUCCESS })
      .getByRole("button", { name: "Kembali ke Undangan", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);

  resetMessages();
});

test("real backend: the message form is labelled, associated, and keyboard operable", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);

  const message = page.getByLabel(/Ucapan Anda/);

  // Real labels, and the required/optional semantics are in the accessible name.
  await expect(page.getByLabel(/Nama Anda \(opsional\)/)).toBeVisible();
  await expect(page.getByLabel(/Ucapan Anda \(wajib\)/)).toBeVisible();
  await expect(message).toHaveAttribute("required", "");

  // Limits are associated with the field, not decorative.
  const describedBy = await message.getAttribute("aria-describedby");

  await expect(page.locator(`#${describedBy!.split(" ")[0]}`)).toContainText(
    "1.000 karakter",
  );

  // The textarea accepts keyboard input.
  await message.focus();
  await page.keyboard.type("Keyboard entry");
  await expect(message).toHaveValue("Keyboard entry");

  // A validation failure is exposed with aria-invalid and an alert.
  await message.fill("   ");
  await sendButton(page).click();

  await expect(message).toHaveAttribute("aria-invalid", "true");
  await expect(
    guestMessageAlert(page).filter({
      hasText: "Silakan tulis ucapan untuk kedua mempelai.",
    }),
  ).toBeVisible();

  // Success moves focus to the confirmation heading, so it is announced.
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  const success = page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS });

  await expect(success).toBeVisible();
  await expect(success).toBeFocused();

  // Back to Invitation is keyboard reachable and returns focus to the hero.
  await page
    .getByRole("region", { name: GUEST_MESSAGE_SUCCESS })
    .getByRole("button", { name: "Kembali ke Undangan", exact: true })
    .focus();
  await page.keyboard.press("Enter");

  await expect(guestMessageForm(page)).toHaveCount(0);
  await expect(page.locator("#invitation-hero-title")).toBeFocused();

  resetMessages();
});
