import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { session, read } = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../src/auth/server-session", () => ({ getServerSession: session }));
vi.mock("../src/rsvps/server-rsvps", () => ({
  getRsvpEvents: read,
  getRsvps: read,
  getRsvpDetail: read,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

import RsvpsPage from "../app/(protected)/rsvps/page";
import RsvpDetailPage from "../app/(protected)/rsvps/[id]/page";
import { RsvpDetailContent } from "../components/rsvp-detail-content";
import { RsvpFilters } from "../components/rsvp-filters";
import { RsvpDetail } from "../components/rsvp-detail";
import { RsvpList, RsvpResults } from "../components/rsvp-list";
import { parseRsvpQuery } from "../src/rsvps/query";
import { auth } from "./fixtures";
import { rsvpDetail, rsvpEvents, rsvpList } from "./rsvp-fixtures";

const query = parseRsvpQuery({})!;

beforeEach(() => {
  session.mockReset();
  read.mockReset();
});

it("gates RSVP pages before data access", async () => {
  session.mockResolvedValue({ kind: "unauthenticated" });
  await expect(
    RsvpsPage({ searchParams: Promise.resolve({}) }),
  ).resolves.toBeNull();
  await expect(
    RsvpDetailPage({ params: Promise.resolve({ id: rsvpDetail.rsvp.id }) }),
  ).resolves.toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it("invalid RSVP URL does not request backend data or echo contents", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  const html = renderToStaticMarkup(
    await RsvpsPage({
      searchParams: Promise.resolve({ search: "private".repeat(100) }),
    }),
  );
  expect(html).toContain("Invalid search or filters");
  expect(html).not.toContain("private");
  expect(read).not.toHaveBeenCalled();
});

it("maps RSVP list fields and excludes pending invitation synthesis", () => {
  const html = renderToStaticMarkup(<RsvpList query={query} data={rsvpList} />);
  for (const value of [
    "Sample household",
    "Owner override household",
    "Accepted v3",
    "Declined v2",
    ">4<",
    ">1<",
    "Guest",
    "OWNER",
    "02 Oct 2026, 00:30",
  ])
    expect(html).toContain(value);
  expect(html).toContain("Persisted RSVPs");
  expect(html).not.toContain("No RSVP");
  expect(html).not.toContain(`>${rsvpList.items[0]!.id}<`);
  expect(html).not.toContain("qrPayload");
});

it("late RSVP backend 401 redirects; 403 remains bounded", async () => {
  read.mockResolvedValue({ kind: "unauthenticated" });
  await expect(RsvpResults({ query })).rejects.toThrow(
    "redirect:/login?session=ended",
  );
  read.mockResolvedValue({ kind: "forbidden" });
  expect(renderToStaticMarkup(await RsvpResults({ query }))).toContain(
    "RSVP access unavailable",
  );
});

it("renders RSVP filter event labels from backend catalog", () => {
  const html = renderToStaticMarkup(
    <RsvpFilters events={rsvpEvents} query={query} />,
  );
  expect(html).toContain("Reception");
  expect(html).toContain("Ceremony");
});

it("maps RSVP detail snapshots, selections, notes, attribution and pass metadata", () => {
  const html = renderToStaticMarkup(<RsvpDetail rsvp={rsvpDetail.rsvp} />);
  for (const value of [
    "Sample household",
    "Accepted v3",
    "Snapshot Guest",
    "Snapshot Companion",
    "Additional child",
    ">2<",
    "Reception",
    "Ceremony",
    "Yes",
    "No",
    "Vegetarian",
    "Please seat us near family",
    "owner@example.com",
    "Guest replied by phone",
    "ACTIVE",
    "REVOKED",
    "RSVP_DECLINED",
  ])
    expect(html).toContain(value);
  expect(html).not.toContain("Current Guest Name");
  for (const value of ["qrPayload", "tokenHash", "publicTokenHash", "csrf"])
    expect(html).not.toContain(value);
});

it.each([
  ["not-found", "RSVP not found"],
  ["forbidden", "RSVP access unavailable"],
  ["unavailable", "Unable to load RSVPs"],
] as const)("renders bounded RSVP detail read state %s", async (kind, copy) => {
  read.mockResolvedValue({ kind });
  const html = renderToStaticMarkup(
    await RsvpDetailContent({
      csrfToken: auth.csrfToken,
      id: rsvpDetail.rsvp.id,
    }),
  );
  expect(html).toContain(copy);
  expect(html).not.toContain("Private backend diagnostic");
  expect(html).not.toContain("qrPayload");
});

it("withholds override form when supporting invitation context is unavailable", () => {
  const html = renderToStaticMarkup(<RsvpDetail rsvp={rsvpDetail.rsvp} />);
  expect(html).toContain("OWNER RSVP override");
  expect(html).toContain("Supporting invitation data was unavailable");
  expect(html).not.toContain("<form");
});
