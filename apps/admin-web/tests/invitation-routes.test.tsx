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
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
import InvitationsPage from "../app/(protected)/invitations/page";
import NewInvitationPage from "../app/(protected)/invitations/new/page";
import {
  InvitationList,
  InvitationResults,
} from "../components/invitation-list";
import { parseInvitationQuery } from "../src/invitations/query";
import { auth } from "./fixtures";
import { list } from "./invitation-fixtures";
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
  expect(html).not.toContain(list.items[0]!.id);
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
