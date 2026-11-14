// A datetime-local input edits Jakarta wall time independently of host timezone.
export function toWibMinute(value: string | null): string {
  if (!value) return "";
  const instant = Date.parse(value);
  return Number.isFinite(instant)
    ? new Date(instant + 7 * 3600000).toISOString().slice(0, 16)
    : "";
}
export function fromWibMinute(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const instant = new Date(`${value}:00+07:00`);
  if (
    !Number.isFinite(instant.getTime()) ||
    toWibMinute(instant.toISOString()) !== value
  )
    return null;
  return instant.toISOString();
}
// An unrelated edit must retain precision of the canonical timestamp.
export function preserveUneditedMinute(
  value: string,
  original: string | null,
  edited: boolean,
): string | null {
  return edited ? (value ? fromWibMinute(value) : null) : original;
}
