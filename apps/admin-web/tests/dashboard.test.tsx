import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { AdminDashboardResponse } from "@wedding-invitation/api-client/src/index";
const { dashboard } = vi.hoisted(() => ({ dashboard: vi.fn() }));
vi.mock("../src/dashboard/server-dashboard", () => ({
  getDashboard: dashboard,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
import { Dashboard, DashboardLoading } from "../components/dashboard";
import { DashboardContent } from "../components/dashboard-content";
import { AdminShell } from "../components/admin-shell";
import { isCurrentSection } from "../components/admin-navigation";

const data: AdminDashboardResponse = {
  invitations: { active: 7, archived: 2, openedActive: 5 },
  rsvp: { pending: 3, accepted: 9, declined: 4 },
  expectedByEvent: [
    {
      event: { id: "b", slug: "z", name: "Z ceremony" },
      expectedAttendeeCount: 11,
    },
    {
      event: { id: "a", slug: "a", name: "A reception" },
      expectedAttendeeCount: 6,
    },
  ],
};
beforeEach(() => dashboard.mockReset());
it("maps all six independent metrics and preserves event order", () => {
  const html = renderToStaticMarkup(<Dashboard data={data} />);
  for (const [label, value] of [
    ["Active Invitations", 7],
    ["Archived Invitations", 2],
    ["Opened Active Invitations", 5],
    ["Pending", 3],
    ["Accepted", 9],
    ["Declined", 4],
  ])
    expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
  expect(html).toContain('scope="row">Z ceremony</th><td>11</td>');
  expect(html).toContain('scope="row">A reception</th><td>6</td>');
  expect(html.indexOf("Z ceremony")).toBeLessThan(html.indexOf("A reception"));
  expect(html).not.toContain("Total Opens");
  expect(html).toContain('scope="col"');
});
it("renders six numeric zeros and an empty attendance aggregate", () => {
  const html = renderToStaticMarkup(
    <Dashboard
      data={{
        invitations: { active: 0, archived: 0, openedActive: 0 },
        rsvp: { pending: 0, accepted: 0, declined: 0 },
        expectedByEvent: [],
      }}
    />,
  );
  expect(html.match(/<dd>0<\/dd>/g)).toHaveLength(6);
  expect(html).toContain("No accepted attending RSVPs yet.");
  expect(html).not.toContain("No Events");
});
it("escapes event text", () => {
  expect(
    renderToStaticMarkup(
      <Dashboard
        data={{
          ...data,
          expectedByEvent: [
            {
              ...data.expectedByEvent[0]!,
              event: { id: "x", slug: "x", name: "<script>alert(1)</script>" },
            },
          ],
        }}
      />,
    ),
  ).toContain("&lt;script&gt;");
});
it("loading communicates progress without invented counts", () => {
  const html = renderToStaticMarkup(<DashboardLoading />);
  expect(html).toContain('role="status"');
  expect(html).toContain("Loading dashboard");
  expect(html).not.toContain("<dd>");
});
it.each(["unavailable", "forbidden"])(
  "shows bounded %s state without counts",
  async (kind) => {
    dashboard.mockResolvedValue({ kind });
    const html = renderToStaticMarkup(await DashboardContent());
    expect(html).toContain(
      kind === "forbidden" ? "not authorized" : "Unable to load dashboard",
    );
    expect(html).toContain('href="/"');
    expect(html).not.toContain("<dd>");
  },
);
it("dashboard 401 uses locked session-ended redirect", async () => {
  dashboard.mockResolvedValue({ kind: "unauthenticated" });
  await expect(DashboardContent()).rejects.toThrow(
    "redirect:/login?session=ended",
  );
});
it("renders the generated dashboard response", async () => {
  dashboard.mockResolvedValue({ kind: "ready", data });
  expect(renderToStaticMarkup(await DashboardContent())).toContain(
    "Z ceremony",
  );
});
it("shell has four exact destinations, current semantics, safe account and existing logout", () => {
  const html = renderToStaticMarkup(
    <AdminShell email="owner@example.test" csrfToken="test-csrf">
      <p>Content</p>
    </AdminShell>,
  );
  for (const [label, path] of [
    ["Dashboard", "/"],
    ["Invitations", "/invitations"],
    ["RSVPs", "/rsvps"],
    ["Messages", "/messages"],
  ]) {
    expect(html).toContain(`href="${path}"`);
    expect(html).toContain(label);
  }
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('aria-label="Primary navigation"');
  expect(html).toContain("owner@example.test");
  expect(html).toContain("Sign out");
  expect(html).not.toContain("test-csrf");
  expect(html).toContain('aria-expanded="false"');
});
it.each([
  ["/", "/", true],
  ["/invitations", "/", false],
  ["/invitations/new", "/invitations", true],
  ["/rsvps/one", "/rsvps", true],
  ["/messages/one", "/messages", true],
  ["/invitations-other", "/invitations", false],
])("active navigation %s -> %s", (path, href, expected) =>
  expect(isCurrentSection(String(path), String(href))).toBe(expected),
);
