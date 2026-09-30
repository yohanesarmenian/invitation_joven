// Used only by Next configuration and the server-only session helper.
export function getAdminApiBaseUrl(): string {
  const url = new URL(
    process.env.ADMIN_API_INTERNAL_BASE_URL ?? "http://127.0.0.1:4000",
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Admin API upstream must be an HTTP(S) origin.");
  }
  return url.origin;
}
