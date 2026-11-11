import { describe, expect, it, vi } from "vitest";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/auth/server-session", () => ({ getServerSession: session }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  useRouter: () => ({ replace: vi.fn() }),
}));
import ReceptionPage from "../app/reception/page";
import ProtectedLayout from "../app/(protected)/layout";
import { auth } from "./fixtures";
import { readAuth } from "../src/auth/auth-state";
import { accountHome } from "../src/auth/navigation";
import { isArrival, isHousehold } from "../src/reception/client";

describe("Reception role and projection boundaries", () => {
  it("routes Guest Managers to their operational workspace and never accepts an arbitrary role", () => {
    expect(accountHome("GUEST_MANAGER")).toBe("/reception");
    expect(accountHome("CHECKIN_STAFF")).toBe("/checkin");
    expect(accountHome("OWNER")).toBe("/");
    expect(
      readAuth({ ...auth, user: { ...auth.user, role: "GUEST_MANAGER" } })?.user
        .role,
    ).toBe("GUEST_MANAGER");
    expect(
      readAuth({
        ...auth,
        user: { ...auth.user, role: "SELF_APPOINTED_OWNER" },
      }),
    ).toBeNull();
  });
  it("guards the server reception route and OWNER shell independently", async () => {
    session.mockResolvedValue({ kind: "unauthenticated" });
    await expect(ReceptionPage()).rejects.toThrow(
      "redirect:/login?session=ended",
    );
    session.mockResolvedValue({
      kind: "authenticated",
      auth: {
        ...auth,
        user: { ...auth.user, role: "GUEST_MANAGER", mustChangePassword: true },
      },
    });
    await expect(ReceptionPage()).rejects.toThrow("redirect:/account/password");
    session.mockResolvedValue({
      kind: "authenticated",
      auth: {
        ...auth,
        user: {
          ...auth.user,
          role: "CHECKIN_STAFF",
          mustChangePassword: false,
        },
      },
    });
    await expect(ReceptionPage()).rejects.toThrow("redirect:/checkin");
    session.mockResolvedValue({
      kind: "authenticated",
      auth: {
        ...auth,
        user: {
          ...auth.user,
          role: "GUEST_MANAGER",
          mustChangePassword: false,
        },
      },
    });
    await expect(
      ProtectedLayout({ children: <p>OWNER private data</p> }),
    ).rejects.toThrow("redirect:/reception");
    await expect(ReceptionPage()).resolves.not.toBeNull();
  });
  it("rejects malformed operational projections and accidental credential fields", () => {
    const household = {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Synthetic household",
      referenceCode: "HJ-000001",
      rsvpStatus: "PENDING",
      rsvpVersion: null,
      eligible: true,
      rsvpLocked: false,
      allowedCount: 2,
      expectedCount: 0,
      arrivedCount: 0,
      remainingCount: 0,
      allowPlusOne: true,
      maxAdditionalChildren: 0,
      invitees: [],
    };
    expect(isHousehold(household)).toBe(true);
    expect(isHousehold({ ...household, qrPayload: "synthetic-only" })).toBe(
      false,
    );
    expect(isHousehold({ ...household, allowedCount: -1 })).toBe(false);
    expect(
      isArrival({
        operationId: household.id,
        attendeeCount: 2,
        totalAfter: 5,
        expectedAttendeeCount: 4,
      }),
    ).toBe(false);
  });
});
