import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureRunnerOrigins, runnerOrigins } from "../e2e-real/origins";

const keys = [
  "ADMIN_ORIGIN",
  "ADMIN_API_INTERNAL_BASE_URL",
  "INVITATION_API_BASE_URL",
  "PUBLIC_INVITATION_BASE_URL",
] as const;
beforeEach(() => {
  vi.resetModules();
  for (const key of keys) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("fails closed when test workers have no configured origins or disagree on API", () => {
  expect(() => runnerOrigins({})).toThrow("must be configured");
  const env = {};
  configureRunnerOrigins(undefined, env);
  expect(() =>
    runnerOrigins({ ...env, INVITATION_API_BASE_URL: "http://127.0.0.1:4000" }),
  ).toThrow("disagree");
});

it("passes journey ports to the runner, its child workers and every server", async () => {
  const { default: config } = await import("../playwright.journey.config");
  const expected = {
    admin: "http://localhost:3101",
    api: "http://127.0.0.1:4100",
    invitation: "http://localhost:3100",
  };
  expect(runnerOrigins()).toEqual(expected);
  expect(config.use?.baseURL).toBe(expected.admin);
  const servers = [config.webServer].flat();
  expect(servers.map((server) => server?.url)).toEqual([
    `${expected.api}/health`,
    `${expected.admin}/login`,
    expected.invitation,
  ]);
  expect(servers[0]?.env).toMatchObject({
    PORT: "4100",
    ADMIN_ORIGIN: expected.admin,
    PUBLIC_INVITATION_BASE_URL: expected.invitation,
  });
  expect(servers[1]?.env?.ADMIN_API_INTERNAL_BASE_URL).toBe(expected.api);
  expect(servers[2]?.env?.INVITATION_API_BASE_URL).toBe(expected.api);
  expect(servers[1]?.command).toContain("--port 3101");
  expect(servers[2]?.command).toContain("--port 3100");
  const inherited = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "-e",
        `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k=>[k,process.env[k]]))))`,
      ],
      { encoding: "utf8", env: process.env },
    ),
  );
  expect(inherited).toEqual({
    ADMIN_ORIGIN: expected.admin,
    ADMIN_API_INTERNAL_BASE_URL: expected.api,
    INVITATION_API_BASE_URL: expected.api,
    PUBLIC_INVITATION_BASE_URL: expected.invitation,
  });
});

it("preserves explicit daily QA origins and keeps derived server ports consistent", async () => {
  vi.stubEnv("ADMIN_ORIGIN", "http://localhost:3201");
  vi.stubEnv("ADMIN_API_INTERNAL_BASE_URL", "http://127.0.0.1:4200");
  vi.stubEnv("PUBLIC_INVITATION_BASE_URL", "http://localhost:3200");
  const { default: config } = await import("../playwright.journey.config");
  expect(runnerOrigins()).toEqual({
    admin: "http://localhost:3201",
    api: "http://127.0.0.1:4200",
    invitation: "http://localhost:3200",
  });
  expect(config.use?.baseURL).toBe("http://localhost:3201");
  const servers = [config.webServer].flat();
  expect(servers[0]?.env?.PORT).toBe("4200");
  expect(servers[1]?.command).toContain("--port 3201");
  expect(servers[2]?.command).toContain("--port 3200");
});

it("keeps the legacy real-browser config's runner and servers on the same ports", async () => {
  const { default: config } = await import("../playwright.real.config");
  expect(runnerOrigins()).toEqual({
    admin: "http://localhost:3001",
    api: "http://127.0.0.1:4000",
    invitation: "http://localhost:3000",
  });
  expect(config.use?.baseURL).toBe("http://localhost:3001");
});

it.each([
  "https://admin.heyjo.my.id",
  "http://user:secret@localhost:3101",
  "http://localhost:3101/path",
])("refuses non-local or non-origin QA targets", (admin) => {
  expect(() =>
    configureRunnerOrigins(undefined, { ADMIN_ORIGIN: admin }),
  ).toThrow();
});
