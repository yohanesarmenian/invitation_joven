type Origins = { admin: string; api: string; invitation: string };
type Environment = Record<string, string | undefined>;

const journeyDefaults: Origins = {
  admin: "http://localhost:3101",
  api: "http://127.0.0.1:4100",
  invitation: "http://localhost:3100",
};

function localOrigin(value: string | undefined): string {
  if (!value)
    throw new Error("Real-browser runner origins must be configured.");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.origin !== value ||
    !url.port
  )
    throw new Error(
      "Real-browser origins must be exact local HTTP origins with ports.",
    );
  return value;
}

// webServer.env only reaches that child process. Configure the runner explicitly
// so Playwright workers and additional browser contexts inherit the same values.
// Respect explicit daily-QA origins when a derived config runs existing servers.
export function configureRunnerOrigins(
  defaults: Origins = journeyDefaults,
  env: Environment = process.env,
): Origins {
  const origins = {
    admin: localOrigin(env.ADMIN_ORIGIN ?? defaults.admin),
    api: localOrigin(env.ADMIN_API_INTERNAL_BASE_URL ?? defaults.api),
    invitation: localOrigin(
      env.PUBLIC_INVITATION_BASE_URL ?? defaults.invitation,
    ),
  };
  Object.assign(env, {
    ADMIN_ORIGIN: origins.admin,
    ADMIN_API_INTERNAL_BASE_URL: origins.api,
    INVITATION_API_BASE_URL: origins.api,
    PUBLIC_INVITATION_BASE_URL: origins.invitation,
  });
  return origins;
}

export function runnerOrigins(env: Environment = process.env): Origins {
  const origins = {
    admin: localOrigin(env.ADMIN_ORIGIN),
    api: localOrigin(env.ADMIN_API_INTERNAL_BASE_URL),
    invitation: localOrigin(env.PUBLIC_INVITATION_BASE_URL),
  };
  if (env.INVITATION_API_BASE_URL !== origins.api)
    throw new Error("Real-browser runner API origins disagree.");
  return origins;
}
