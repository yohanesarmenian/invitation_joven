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

export const wibMinuteError =
  "Enter a complete date, hour and minute in WIB, or use Clear to remove it.";

export type WibMinuteEdit =
  | { kind: "valid"; input: string; timestamp: string }
  | { kind: "invalid"; input: string }
  | { kind: "clear"; input: "" };

export function readWibMinuteEdit({
  value,
  validity,
}: {
  value: string;
  validity: Pick<ValidityState, "badInput">;
}): WibMinuteEdit {
  // A previous value with seconds can shift the native step base. Validate
  // minute precision from the value itself so correcting that edit succeeds.
  const timestamp = validity.badInput ? null : fromWibMinute(value);
  // Even a native empty value may represent incomplete or sanitized input.
  return timestamp
    ? { kind: "valid", input: value, timestamp }
    : { kind: "invalid", input: value };
}

// Invalid input leaves the draft timestamp intact, and callers block its submission.
export function wibMinuteTimestamp<T extends string | null>(
  original: T,
  edit: WibMinuteEdit | undefined,
  empty: T,
): string | T {
  if (edit?.kind === "valid") return edit.timestamp;
  if (edit?.kind === "clear") return empty;
  return original;
}
