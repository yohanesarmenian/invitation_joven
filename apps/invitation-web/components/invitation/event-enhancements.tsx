"use client";
import { useEffect, useState } from "react";
import { calendarFile, type CalendarEvent } from "../../src/events/calendar";
import { nextEvent } from "../../src/events/countdown";
export function EventCalendar({ event }: { event: CalendarEvent }) {
  const [message, setMessage] = useState("");
  if (!event.startsAt || !Number.isFinite(Date.parse(event.startsAt)))
    return null;
  function download() {
    const content = calendarFile(event);
    if (!content) return;
    const url = URL.createObjectURL(
        new Blob([content], { type: "text/calendar;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "wedding-event.ics";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Calendar file downloaded. Open it in your calendar app.");
  }
  return (
    <>
      <button
        type="button"
        className="map-link calendar-button"
        onClick={download}
      >
        Add to calendar
      </button>
      <span className="visually-hidden" role="status">
        {message}
      </span>
    </>
  );
}
export function EventCountdown({
  events,
  initialNow,
}: {
  events: CalendarEvent[];
  initialNow: number;
}) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const next = nextEvent(events, now);
  if (!next) return null;
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(next.startsAt!) - now) / 1000),
  );
  const parts = [
    { label: "Days", value: Math.floor(seconds / 86400) },
    { label: "Hours", value: Math.floor((seconds % 86400) / 3600) },
    { label: "Minutes", value: Math.floor((seconds % 3600) / 60) },
    { label: "Seconds", value: seconds % 60 },
  ];
  return (
    <section
      className="event-countdown"
      aria-label={`Time until ${next.name}`}
      aria-live="off"
    >
      <p className="countdown-kicker">Counting down to {next.name}</p>
      <div className="countdown-grid">
        {parts.map(({ label, value }) => (
          <div className="countdown-part" key={label}>
            <span
              className="countdown-value"
              data-countdown-unit={label.toLowerCase()}
            >
              {String(value).padStart(2, "0")}
            </span>
            <span className="countdown-label">{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
