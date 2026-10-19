import type { PublicInvitationResponse } from "../../../../packages/api-client/src/index";
export type CalendarEvent = Pick<
  PublicInvitationResponse["invitation"]["events"][number],
  "id" | "name" | "startsAt" | "endsAt" | "venueName" | "address"
>;
const escapeText = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
const stamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
function fold(value: string): string {
  const lines: string[] = [];
  let line = "",
    bytes = 0;
  const encoder = new TextEncoder();
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += char;
    bytes += size;
  }
  lines.push(line);
  return lines.join("\r\n");
}
export function calendarFile(
  event: CalendarEvent,
  generatedAt = new Date(),
): string | null {
  if (!event.startsAt || !Number.isFinite(Date.parse(event.startsAt)))
    return null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jo and Venta//Wedding invitation//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeText(event.id)}@wedding.local`,
    `DTSTAMP:${stamp(generatedAt.toISOString())}`,
    `DTSTART:${stamp(event.startsAt)}`,
  ];
  if (
    event.endsAt &&
    Number.isFinite(Date.parse(event.endsAt)) &&
    Date.parse(event.endsAt) > Date.parse(event.startsAt)
  )
    lines.push(`DTEND:${stamp(event.endsAt)}`);
  lines.push(`SUMMARY:${escapeText(`${event.name} — Jo & Venta`)}`);
  const location = [event.venueName, event.address].filter(Boolean).join(", ");
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
