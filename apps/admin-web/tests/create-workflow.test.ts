import { expect, it } from "vitest";
import {
  initialCreateFields,
  safeInvitationUrl,
  weddingEventIssue,
  whatsappInvitationUrl,
  withGuestDisplayName,
} from "../src/invitations/create-workflow";
import { prepareInvitation } from "../src/invitations/form-state";
import { events } from "./invitation-fixtures";
const single = [events[0]!];
const publicUrl = "https://invite.example.com/i/" + "A".repeat(43);
it("uses exactly the existing active event and defaults optional fields without guessing guest data", () => {
  const fields = initialCreateFields(single);
  expect(fields.eventIds).toEqual([single[0]!.id]);
  expect(fields.invitees[0]!.fullName).toBe("");
  fields.invitees[0]!.fullName = "  Guest  ";
  expect(prepareInvitation(withGuestDisplayName(fields), single)).toEqual({
    errors: {},
    body: {
      displayName: "Guest",
      greetingName: null,
      allowPlusOne: false,
      maxAdditionalChildren: 0,
      rsvpDeadlineAt: null,
      notes: null,
      eventIds: [single[0]!.id],
      invitees: [{ fullName: "Guest", category: "ADULT", label: null }],
    },
  });
  expect(
    withGuestDisplayName({ ...fields, displayName: " Household " }).displayName,
  ).toBe("Household");
});
it("blocks empty, multiple, inactive and invalid event configuration without choosing or changing records", () => {
  for (const catalog of [
    [],
    events,
    [{ ...events[0]!, isActive: false }],
    [{ ...events[0]!, name: " " }],
  ]) {
    expect(weddingEventIssue(catalog)).toBeTypeOf("string");
    expect(initialCreateFields(catalog).eventIds).toEqual([]);
  }
});
it("accepts only a usable bearer route and explicitly encoded WhatsApp sharing", () => {
  expect(safeInvitationUrl(publicUrl)).toBe(true);
  const share = new URL(whatsappInvitationUrl(publicUrl)!);
  expect(share.origin).toBe("https://wa.me");
  expect(share.searchParams.get("text")).toBe(
    "You are invited. Please open your invitation: " + publicUrl,
  );
  for (const invalid of [
    "javascript:alert(1)",
    "https://user:secret@invite.example.com/i/" + "A".repeat(43),
    "https://invite.example.com/",
    publicUrl + "?token=secret",
    publicUrl + "#fragment",
    "https://invite.example.com/i/short",
    "http://invite.example.com/i/" + "A".repeat(43),
  ]) {
    expect(safeInvitationUrl(invalid)).toBe(false);
    expect(whatsappInvitationUrl(invalid)).toBeNull();
  }
});
