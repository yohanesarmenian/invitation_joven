import { isUuid } from "../invitations/contract";

export function eventSelection(value: string | string[] | undefined) {
  if (value === undefined) return null;
  return typeof value === "string" && isUuid(value)
    ? value.toLowerCase()
    : "invalid";
}

export function eventHref(path: "/events" | "/event-content", id: string) {
  return `${path}?eventId=${encodeURIComponent(id)}`;
}

export function replaceEventSelection(
  path: "/events" | "/event-content",
  id?: string,
) {
  window.history.replaceState(
    window.history.state,
    "",
    id ? eventHref(path, id) : path,
  );
}
