import { expect, it } from "vitest";
import { personalMessage } from "./personal-message";
it("uses only supplied eligible event data and formats Jakarta instants without inventing missing details", () => {
  const text = personalMessage(
    {
      greeting: "Synthetic household",
      deadline: "2026-12-25T16:59:59Z",
      events: [
        {
          id: "event",
          name: "Reception",
          slug: "reception",
          isActive: true,
          displayOrder: 1,
          startsAt: "2027-01-09T05:00:00Z",
          venueName: "Synthetic venue",
          address: null,
        },
      ],
    },
    "https://invitation.example.test/current",
  );
  expect(text).toContain("Dear Synthetic household");
  expect(text).toContain("9 January 2027 at 12:00");
  expect(text).toContain("25 December 2026 at 23:59");
  expect(text).toContain("Synthetic venue");
  expect(text).not.toContain("null");
  expect(text).toContain("https://invitation.example.test/current");
});
