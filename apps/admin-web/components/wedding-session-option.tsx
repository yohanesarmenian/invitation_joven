import { useId } from "react";
import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";

type WeddingSession = AdminEventsResponse["events"][number];
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeZone: "Asia/Jakarta",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Jakarta",
});

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function WeddingSessionDetails({
  session,
  id,
}: {
  session: WeddingSession;
  id?: string;
}) {
  const start = parseDate(session.startsAt);
  const end = parseDate(session.endsAt);
  const startDate = start && dateFormat.format(start);
  const endDate = end && dateFormat.format(end);
  const schedule = start
    ? end && startDate === endDate
      ? `${startDate} · ${timeFormat.format(start)}–${timeFormat.format(end)} WIB`
      : `Starts ${startDate} · ${timeFormat.format(start)} WIB`
    : "Start date and time not set";

  return (
    <span className="wedding-session-details" id={id}>
      <span>{schedule}</span>
      {!end ? (
        <span>End date and time not set</span>
      ) : startDate !== endDate ? (
        <span>
          Ends {endDate} · {timeFormat.format(end)} WIB
        </span>
      ) : null}
      <span>{session.venueName?.trim() || "Venue not set"}</span>
    </span>
  );
}

export function WeddingSessionOption({
  session,
  checked,
  disabled,
  current,
  invalid,
  describedBy,
  onChange,
}: {
  session: WeddingSession;
  checked: boolean;
  disabled?: boolean;
  current?: boolean;
  invalid?: boolean;
  describedBy: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="wedding-session-option">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-details ${describedBy}`}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="wedding-session-content">
        <strong id={`${id}-name`}>{session.name}</strong>
        <span id={`${id}-details`}>
          <WeddingSessionDetails session={session} />
          {(current || !session.isActive) && (
            <span className="wedding-session-state">
              {session.isActive
                ? "Currently eligible"
                : current
                  ? "Inactive, currently eligible"
                  : "Inactive, cannot be added"}
            </span>
          )}
        </span>
      </span>
    </label>
  );
}
