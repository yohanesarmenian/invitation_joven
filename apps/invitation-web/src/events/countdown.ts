export function nextEvent<T extends { startsAt: string | null }>(
  events: readonly T[],
  now: number,
): T | null {
  return events.reduce<T | null>((next, event) => {
    const start = event.startsAt ? Date.parse(event.startsAt) : NaN;
    return Number.isFinite(start) &&
      start > now &&
      (!next || start < Date.parse(next.startsAt!))
      ? event
      : next;
  }, null);
}
export function remainingMinutes(startsAt: string, now: number) {
  return Math.max(0, Math.ceil((Date.parse(startsAt) - now) / 60_000));
}
