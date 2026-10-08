export const BASE_HEADERS = [
  "displayName",
  "greetingName",
  "allowPlusOne",
  "maxAdditionalChildren",
  "rsvpDeadlineLocal",
  "notes",
  "invitees",
] as const;
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
export function importTemplate(eventSlugs: readonly string[]): string {
  return (
    [
      ...BASE_HEADERS,
      ...[...new Set(eventSlugs)].sort().map((slug) => `event:${slug}`),
    ]
      .map(csvCell)
      .join(",") + "\r\n"
  );
}
export function fileProblem(file: Pick<File, "name" | "size">): string | null {
  if (!/\.(csv|xlsx)$/i.test(file.name)) return "Choose a .csv or .xlsx file.";
  if (file.size > 5 * 1024 * 1024) return "The file exceeds the 5 MiB limit.";
  return null;
}
