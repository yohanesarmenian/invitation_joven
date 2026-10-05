import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { session, read } = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../src/auth/server-session", () => ({ getServerSession: session }));
vi.mock("../src/invitations/server-invitations", () => ({
  getInvitations: read,
  getEvents: read,
  getInvitationDetail: read,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
import InvitationsPage from "../app/(protected)/invitations/page";
import InvitationDetailPage from "../app/(protected)/invitations/[id]/page";
import { DetailContent } from "../app/(protected)/invitations/[id]/page";
import EditInvitationPage from "../app/(protected)/invitations/[id]/edit/page";
import NewInvitationPage from "../app/(protected)/invitations/new/page";
import { InvitationDetail } from "../components/invitation-detail";
import {
  InvitationList,
  InvitationResults,
} from "../components/invitation-list";
import { parseInvitationQuery } from "../src/invitations/query";
import { auth } from "./fixtures";
import { detail, events, list } from "./invitation-fixtures";
const query = parseInvitationQuery({})!;
beforeEach(() => {
  session.mockReset();
  read.mockReset();
});
it.each(["unauthenticated", "forbidden", "unavailable"])(
  "gates both parallel page payloads on %s before data access",
  async (kind) => {
    session.mockResolvedValue({ kind });
    expect(
      await InvitationsPage({ searchParams: Promise.resolve({}) }),
    ).toBeNull();
    expect(await NewInvitationPage()).toBeNull();
    expect(read).not.toHaveBeenCalled();
  },
);
it("invalid URL does not request backend data or echo its contents", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  const html = renderToStaticMarkup(
    await InvitationsPage({
      searchParams: Promise.resolve({ search: "private".repeat(100) }),
    }),
  );
  expect(html).toContain("Invalid search or filters");
  expect(html).not.toContain("private");
  expect(read).not.toHaveBeenCalled();
});
it("maps distinct fields with Jakarta dates and no raw IDs or credentials", () => {
  const html = renderToStaticMarkup(
    <InvitationList query={query} data={list} />,
  );
  for (const value of [
    "Sample household",
    "Dear sample guests",
    "Active",
    "Accepted",
    ">3<",
    ">7<",
    "02 Oct 2026, 00:30",
    "25 Dec 2026, 23:59",
  ])
    expect(html).toContain(value);
  expect(html).not.toContain(`>${list.items[0]!.id}<`);
  expect(html).not.toContain("publicUrl");
});
it("late backend 401 redirects; 403 remains bounded", async () => {
  read.mockResolvedValue({ kind: "unauthenticated" });
  await expect(InvitationResults({ query })).rejects.toThrow(
    "redirect:/login?session=ended",
  );
  read.mockResolvedValue({ kind: "forbidden" });
  expect(renderToStaticMarkup(await InvitationResults({ query }))).toContain(
    "Invitation access unavailable",
  );
});
it("gates detail and edit pages before data access", async () => {
  session.mockResolvedValue({ kind: "unauthenticated" });
  await expect(
    InvitationDetailPage({
      params: Promise.resolve({ id: detail.invitation.id }),
      searchParams: Promise.resolve({}),
    }),
  ).resolves.toBeNull();
  await expect(
    EditInvitationPage({ params: Promise.resolve({ id: detail.invitation.id }) }),
  ).resolves.toBeNull();
  expect(read).not.toHaveBeenCalled();
});
it("maps detail fields and excludes sensitive values", () => {
  const html = renderToStaticMarkup(
    <InvitationDetail
      csrfToken="csrf"
      events={events}
      invitation={detail.invitation}
    />,
  );
  for (const value of [
    "Sample household",
    "Internal note",
    "Sample guest",
    "Sample child",
    "Reception",
    "Old event",
    "Inactive",
    "Add invitee",
    "Save event eligibility",
    "accepted v2",
    "2 total, 1 hidden",
    "ACTIVE",
    "Public token version",
  ])
    expect(html).toContain(value);
  for (const value of [
    "publicTokenHash",
    "tokenHash",
    "qrPayload",
    "sessionToken",
    "csrf",
    "publicUrl",
  ])
    expect(html).not.toContain(value);
});
it.each([
  ["not-found", "Invitation not found"],
  ["forbidden", "Invitation access unavailable"],
  ["unavailable", "Unable to load invitations"],
] as const)("renders bounded detail read state %s", async (kind, copy) => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  read.mockResolvedValue({ kind });
  const html = renderToStaticMarkup(
    await DetailContent({
      csrfToken: auth.csrfToken,
      id: detail.invitation.id,
    }),
  );
  expect(html).toContain(copy);
  expect(html).not.toContain("Private backend diagnostic");
  expect(html).not.toContain("publicUrl");
  expect(html).not.toContain("qrPayload");
});
