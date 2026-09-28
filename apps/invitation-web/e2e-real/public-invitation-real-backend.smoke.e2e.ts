import { expect, test } from "@playwright/test";
import {
  readSmokeState,
  runFixtureCli,
  type SmokeFixtureRead,
} from "./smoke-fixture";

// Internal fields that must never reach the browser. `publicTokenHash` in
// particular would let the raw credential be recovered by brute force offline.
const LEAKED_INTERNAL_FIELDS = [
  "publicTokenHash",
  "publicTokenVersion",
  "firstOpenedAt",
  "lastOpenedAt",
  "openCount",
  "open_count",
];

test("real backend: one retrieval per server render, client stages stay local", async ({
  page,
}) => {
  const state = readSmokeState();
  const expectedOpenCount = state.beforeOpenCount + 1;

  await page.goto(`/i/${state.publicCredential}`);

  // Closed state: the invitation was retrieved server-side exactly once for
  // this render, which is what bumps open_count.
  const openButton = page.getByRole("button", { name: "Open invitation" });
  await expect(openButton).toBeVisible();
  await expect(page.getByRole("heading", { name: "Smoke Guest" })).toBeHidden();

  const afterRender = runFixtureCli<SmokeFixtureRead>("read");
  expect(afterRender.openCount).toBe(expectedOpenCount);
  expect(afterRender.firstOpenedAtPresent).toBe(true);
  expect(afterRender.lastOpenedAtPresent).toBe(true);

  await openButton.click();

  // Opened state: a client-side stage change, so no new server render.
  const viewButton = page.getByRole("button", { name: "View invitation" });
  await expect(viewButton).toBeVisible();
  expect(runFixtureCli<SmokeFixtureRead>("read").openCount).toBe(
    expectedOpenCount,
  );

  await viewButton.click();

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

  // Privacy: no internal field and no database identifier is serialized into
  // the document. The credential itself is intentionally in the route URL, so
  // this only asserts it is not rendered as visible content.
  const html = await page.content();
  const visibleText = await page.locator("body").innerText();

  for (const field of LEAKED_INTERNAL_FIELDS) {
    expect(html).not.toContain(field);
  }

  expect(html).not.toContain(state.invitationId);
  expect(html).not.toContain(state.eventId);
  expect(visibleText).not.toContain(state.publicCredential);
});
