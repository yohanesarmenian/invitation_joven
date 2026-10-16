import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/auth/server-session", () => ({ getServerSession: session }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
import ProtectedLayout from "../app/(protected)/layout";
import DashboardPage from "../app/(protected)/page";
import PasswordPage from "../app/account/password/page";
import CheckinPage from "../app/checkin/page";
import LoginPage from "../app/login/page";
import { LoginForm } from "../components/login-form";
import { auth } from "./fixtures";
import EventContentPage from "../app/(protected)/event-content/page";
const staffAuth = {
  ...auth,
  user: {
    ...auth.user,
    id: "synthetic-checkin-staff",
    email: "staff@example.com",
    role: "CHECKIN_STAFF" as const,
  },
};
const changeRequiredAuth = {
  ...staffAuth,
  user: { ...staffAuth.user, mustChangePassword: true },
};
beforeEach(() => session.mockReset());
it("renders event-material controls only for an OWNER session", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  const html = renderToStaticMarkup(await EventContentPage());
  expect(html).toContain("Event materials");
  expect(html).toContain("Event materials editor");
});
it("denies staff and unauthenticated access before event-material content renders", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth: staffAuth });
  await expect(EventContentPage()).rejects.toThrow("redirect:/checkin");
  session.mockResolvedValue({ kind: "unauthenticated" });
  await expect(EventContentPage()).rejects.toThrow(
    "redirect:/login?session=ended",
  );
});
it("renders semantic login controls and accessible session notice", () => {
  const html = renderToStaticMarkup(<LoginForm sessionEnded />);
  expect(html).toContain('for="email"');
  expect(html).toContain('for="password"');
  expect(html).toContain('type="password"');
  expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain('autoComplete="username"');
  expect(html).toContain('role="status"');
  expect(html).toContain('method="post"');
  expect(html).toContain('action="/api/admin/auth/login"');
  expect(html).toContain("Your admin session has ended. Please sign in again.");
});
it("server renders OWNER shell and content", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  const html = renderToStaticMarkup(
    await ProtectedLayout({ children: <p>Protected child</p> }),
  );
  expect(html).toContain("owner@example.com");
  expect(html).toContain("OWNER");
  expect(html).toContain("Protected child");
  expect(html).not.toContain("synthetic-owner");
  expect(html).toContain("Sign out");
});
it("redirects before rendering unauthenticated content", async () => {
  session.mockResolvedValue({ kind: "unauthenticated" });
  await expect(
    ProtectedLayout({ children: <p>Protected child</p> }),
  ).rejects.toThrow("redirect:/login?session=ended");
});
it("redirects check-in staff before rendering OWNER protected content", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth: staffAuth });
  await expect(
    ProtectedLayout({ children: <p>OWNER-only child</p> }),
  ).rejects.toThrow("redirect:/checkin");
});
it("redirects forced password-change sessions before rendering protected content", async () => {
  session.mockResolvedValue({
    kind: "authenticated",
    auth: changeRequiredAuth,
  });
  await expect(
    ProtectedLayout({ children: <p>OWNER-only child</p> }),
  ).rejects.toThrow("redirect:/account/password");
});
it.each(["unavailable", "forbidden"])(
  "never renders shell on %s session",
  async (kind) => {
    session.mockResolvedValue({ kind });
    const html = renderToStaticMarkup(
      await ProtectedLayout({ children: <p>Protected child</p> }),
    );
    expect(html).not.toContain("Protected child");
    expect(html).not.toContain("Sign out");
    expect(html).toContain("Admin access unavailable");
  },
);
it("authenticated login page redirects server-side", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  await expect(
    LoginPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toThrow("redirect:/");
});
it("public login renders without a session", async () => {
  session.mockResolvedValue({ kind: "unauthenticated" });
  expect(
    renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({ session: "ended" }) }),
    ),
  ).toContain("Your admin session has ended. Please sign in again.");
});
it("check-in route renders the restricted staff workspace without OWNER navigation", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth: staffAuth });
  const html = renderToStaticMarkup(await CheckinPage());
  expect(html).toContain("Check-in");
  expect(html).toContain("Select an event");
  expect(html).toContain("Validate QR");
  expect(html).toContain("staff@example.com");
  expect(html).toContain("Sign out");
  expect(html).not.toContain("Wedding Invitation");
  expect(html).not.toContain("Dashboard");
  expect(html).not.toContain("Invitations");
});
it("check-in route allows OWNER and provides a dashboard return link", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  const html = renderToStaticMarkup(await CheckinPage());
  expect(html).toContain("Select an event");
  expect(html).toContain("Back to dashboard");
});
it("check-in route does not bypass forced password change", async () => {
  session.mockResolvedValue({
    kind: "authenticated",
    auth: changeRequiredAuth,
  });
  await expect(CheckinPage()).rejects.toThrow("redirect:/account/password");
});
it("password-change route renders for forced staff sessions without OWNER shell", async () => {
  session.mockResolvedValue({
    kind: "authenticated",
    auth: changeRequiredAuth,
  });
  const html = renderToStaticMarkup(await PasswordPage());
  expect(html).toContain("Change password");
  expect(html).toContain("Current password");
  expect(html).toContain("New password");
  expect(html).not.toContain("Dashboard");
  expect(html).not.toContain("Invitations");
});

it.each(["unauthenticated", "unavailable", "forbidden"])(
  "page emits no content while layout resolves %s",
  async (kind) => {
    session.mockResolvedValue({ kind });
    expect(await DashboardPage()).toBeNull();
  },
);
it("page renders only after its own session check", async () => {
  session.mockResolvedValue({ kind: "authenticated", auth });
  expect(renderToStaticMarkup(await DashboardPage())).toContain("Dashboard");
});
