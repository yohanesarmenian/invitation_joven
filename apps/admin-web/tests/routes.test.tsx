import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../src/auth/server-session", () => ({ getServerSession: session }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
import ProtectedLayout from "../app/(protected)/layout";
import DashboardPage from "../app/(protected)/page";
import LoginPage from "../app/login/page";
import { LoginForm } from "../components/login-form";
import { auth } from "./fixtures";
beforeEach(() => session.mockReset());
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
