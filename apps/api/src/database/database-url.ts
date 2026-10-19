import "dotenv/config";

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for the API database connection.",
    );
  }

  // Keep adapter timestamp handling invariant across server/host timezones.
  // Force UTC for every application/test pool, preserving other pool options.
  const url = new URL(databaseUrl);
  const existing = url.searchParams.get("options")?.trim();
  url.searchParams.set(
    "options",
    [existing, "-c timezone=UTC"].filter(Boolean).join(" "),
  );
  return url.toString();
}
