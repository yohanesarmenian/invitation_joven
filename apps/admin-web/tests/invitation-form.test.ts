import { expect, it } from "vitest";
import {
  deadlineToIso,
  prepareInvitation,
  type CreateFields,
} from "../src/invitations/form-state";
import { body, events } from "./invitation-fixtures";
const fields: CreateFields = { ...body, children: "0", deadline: "" };
it("builds exact generated payload, trims nullable text, preserves duplicate invitees and order", () => {
  const result = prepareInvitation(
    {
      ...fields,
      displayName: " Sample household ",
      greetingName: " ",
      notes: " internal ",
      invitees: [
        { fullName: " Twin ", category: "ADULT", label: " " },
        { fullName: " Twin ", category: "CHILD", label: "youngest" },
      ],
    },
    events,
  );
  expect(result.errors).toEqual({});
  expect(result.body).toEqual({
    ...body,
    notes: "internal",
    invitees: [
      { fullName: "Twin", category: "ADULT", label: null },
      { fullName: "Twin", category: "CHILD", label: "youngest" },
    ],
  });
});
it.each(["-1", "", "1.5", "1e3", "9007199254740992"])(
  "rejects invalid children %s",
  (children) =>
    expect(
      prepareInvitation({ ...fields, children }, events).errors.children,
    ).toBeDefined(),
);
it("requires identity, an active unique event and a named invitee", () => {
  expect(
    prepareInvitation(
      { ...fields, displayName: " ", eventIds: [], invitees: [] },
      events,
    ).errors,
  ).toHaveProperty("invitees");
  expect(
    prepareInvitation({ ...fields, eventIds: [events[2]!.id] }, events).errors,
  ).toHaveProperty("eventIds");
  expect(
    prepareInvitation(
      { ...fields, eventIds: [events[0]!.id, events[0]!.id] },
      events,
    ).errors,
  ).toHaveProperty("eventIds");
  expect(
    prepareInvitation(
      { ...fields, invitees: [{ fullName: " ", category: "ADULT" }] },
      events,
    ).errors,
  ).toHaveProperty("invitee-0");
});
it("does not invent text limits or minimum future deadline", () => {
  expect(
    prepareInvitation(
      {
        ...fields,
        displayName: "x".repeat(1001),
        children: "9007199254740991",
        deadline: "2020-01-01T00:00",
      },
      events,
    ).errors,
  ).toEqual({});
});
it.each(["UTC", "America/New_York", "Asia/Jakarta"])(
  "serializes Jakarta wall time independently of %s host",
  (zone) => {
    const old = process.env.TZ;
    process.env.TZ = zone;
    try {
      expect(deadlineToIso("2026-12-25T23:59:59")).toBe(
        "2026-12-25T16:59:59.000Z",
      );
      expect(deadlineToIso("2026-10-02T00:30")).toBe(
        "2026-10-01T17:30:00.000Z",
      );
    } finally {
      if (old === undefined) delete process.env.TZ;
      else process.env.TZ = old;
    }
  },
);
it.each([
  "2026-02-30T12:00",
  "2026-13-01T12:00",
  "2026-01-01T24:00",
  "invalid",
])("rejects impossible date %s", (date) =>
  expect(deadlineToIso(date)).toBeNull(),
);
