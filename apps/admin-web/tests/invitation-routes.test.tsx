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
import { DetailContent } from "../components/invitation-detail-content";
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
it("keeps one semantic table and one detail link per invitation for responsive rows", () => {
  const html = renderToStaticMarkup(
    <InvitationList query={query} data={list} />,
  );
  expect(html.match(/<table\b/g)).toHaveLength(1);
  expect(html.match(/<tbody\b/g)).toHaveLength(1);
  expect(html.match(/scope="col"/g)).toHaveLength(7);
  expect(html.match(/scope="row"/g)).toHaveLength(list.items.length);
  expect(html).toContain(
    'class="invitation-table invitation-table--responsive" role="table"',
  );
  expect(html).toContain('aria-label="Invitations table"');
  expect(html).toContain('aria-describedby="table-help" tabindex="0"');
  expect(html).toContain(
    '<th scope="row" role="rowheader" class="invitation-identity">',
  );
  expect(html.match(/<a\b/g)).toHaveLength(list.items.length);
  expect(html).toContain(`href="/invitations/${list.items[0]!.id}"`);
  expect(html).toContain(
    '<span class="invitation-name">Sample household</span>',
  );
  expect(html).toContain(
    '<span class="invitation-manage" aria-hidden="true">Manage invitation',
  );
  expect(html.match(/Sample household/g)).toHaveLength(1);
  expect(html.match(/Dear sample guests/g)).toHaveLength(1);
  for (const label of [
    "Status",
    "RSVP",
    "Invitees",
    "Opens",
    "Last opened",
    "RSVP deadline",
  ])
    expect(html).toContain(`data-label="${label}"`);
  expect(html).not.toContain("scroll the table horizontally");
});
it.each([
  ["ACTIVE", "PENDING", "Active", "Pending"],
  ["ARCHIVED", "ACCEPTED", "Archived", "Accepted"],
  ["ACTIVE", "DECLINED", "Active", "Declined"],
] as const)(
  "retains %s/%s status, zero counts and missing activity",
  (status, rsvpStatus, statusLabel, rsvpLabel) => {
    const html = renderToStaticMarkup(
      <InvitationList
        query={query}
        data={{
          ...list,
          items: [
            {
              ...list.items[0]!,
              status,
              rsvpStatus,
              greetingName: null,
              inviteeCount: 0,
              openCount: 0,
              lastOpenedAt: null,
              rsvpDeadlineAt: null,
            },
          ],
        }}
      />,
    );
    expect(html).toContain(`data-status="${status}">${statusLabel}</span>`);
    expect(html).toContain(
      `data-rsvp-status="${rsvpStatus}">${rsvpLabel}</span>`,
    );
    expect(html).toContain('data-label="Invitees">0</td>');
    expect(html).toContain('data-label="Opens">0</td>');
    expect(html).toContain("Not opened");
    expect(html).toContain("No deadline");
    expect(html).not.toContain('class="greeting-name"');
    expect(html).not.toContain("<time");
  },
);
it("retains filtered totals and query parameters in both pagination links", () => {
  const filteredQuery = parseInvitationQuery({
    search: "Sample & family",
    status: "ARCHIVED",
    rsvpStatus: "PENDING",
    page: "2",
  })!;
  const html = renderToStaticMarkup(
    <InvitationList
      query={filteredQuery}
      data={{
        ...list,
        page: { ...list.page, number: 2, totalPages: 3, totalItems: 51 },
      }}
    />,
  );
  expect(html).toContain("51 invitations matching your search and filters");
  expect(html).toContain("Page 2 · 3 pages of results");
  expect(html).toContain(
    'href="/invitations?page=1&amp;pageSize=25&amp;sortBy=createdAt&amp;sortOrder=desc&amp;status=ARCHIVED&amp;rsvpStatus=PENDING&amp;search=Sample+%26+family">Previous',
  );
  expect(html).toContain(
    'href="/invitations?page=3&amp;pageSize=25&amp;sortBy=createdAt&amp;sortOrder=desc&amp;status=ARCHIVED&amp;rsvpStatus=PENDING&amp;search=Sample+%26+family">Next',
  );
});
it.each([
  [false, 0, "No invitations yet", "/invitations/new", "Create an invitation"],
  [
    true,
    0,
    "No matching invitations",
    "/invitations",
    "Clear search and filters",
  ],
  [
    true,
    1,
    "No invitations on this page",
    "/invitations?page=1&amp;pageSize=25&amp;sortBy=createdAt&amp;sortOrder=desc&amp;search=Sample",
    "First page",
  ],
] as const)(
  "retains the empty result recovery for filtered=%s total=%s",
  (filtered, totalItems, heading, href, action) => {
    const html = renderToStaticMarkup(
      <InvitationList
        query={
          filtered
            ? parseInvitationQuery({ search: "Sample", page: "2" })!
            : query
        }
        data={{ items: [], page: { ...list.page, totalItems } }}
      />,
    );
    expect(html).toContain(`<h3>${heading}</h3>`);
    expect(html).toContain(`href="${href}">${action}</a>`);
    expect(html).not.toContain("<table");
    expect(html).not.toContain('class="invitation-manage"');
  },
);
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
    EditInvitationPage({
      params: Promise.resolve({ id: detail.invitation.id }),
    }),
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
