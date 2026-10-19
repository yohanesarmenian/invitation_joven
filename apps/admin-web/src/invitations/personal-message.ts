import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
export type MessageContext = {
  greeting: string;
  deadline: string | null;
  events: AdminEventsResponse["events"];
};
const format = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  dateStyle: "long",
  timeStyle: "short",
});
export function personalMessage(context: MessageContext, publicUrl: string) {
  const lines = [
    `Dear ${context.greeting},`,
    "",
    "We would love to celebrate our wedding with you.",
    "Jo & Venta",
    "",
  ];
  for (const event of context.events) {
    const time =
      event.startsAt && Number.isFinite(Date.parse(event.startsAt))
        ? `${format.format(new Date(event.startsAt))} (Jakarta)`
        : null;
    lines.push(
      [event.name, time, event.venueName, event.address]
        .filter(Boolean)
        .join(" · "),
    );
  }
  if (context.deadline && Number.isFinite(Date.parse(context.deadline)))
    lines.push(
      "",
      `Kindly RSVP by ${format.format(new Date(context.deadline))} (Jakarta).`,
    );
  lines.push("", "Your invitation and RSVP:", publicUrl);
  return lines.join("\n");
}
