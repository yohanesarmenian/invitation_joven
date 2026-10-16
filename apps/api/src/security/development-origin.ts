/** HTTP is permitted only on an explicit loopback host outside production. */
export function isLoopbackDevelopmentOrigin(url: URL): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}
