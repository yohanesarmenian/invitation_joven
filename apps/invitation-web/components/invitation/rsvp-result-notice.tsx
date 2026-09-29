import type { Ref } from "react";
import type { RsvpNotice } from "../../src/rsvp/notice";

export function RsvpResultNotice({
  notice,
  id,
  noticeRef,
  pending,
  onReload,
  onReview,
}: {
  notice: RsvpNotice;
  id: string;
  noticeRef?: Ref<HTMLDivElement>;
  pending: boolean;
  onReload: () => void;
  onReview: () => void;
}) {
  return (
    <div
      id={id}
      className={`rsvp-notice rsvp-notice-${notice.tone}`}
      role="alert"
      tabIndex={-1}
      ref={noticeRef}
    >
      <h3>{notice.title}</h3>
      <p>{notice.message}</p>
      {notice.recovery === "reload" ? (
        <button
          type="button"
          className="rsvp-notice-action"
          disabled={pending}
          onClick={onReload}
        >
          {pending ? "Loading RSVP…" : "Reload latest RSVP"}
        </button>
      ) : null}
      {notice.recovery === "correct" ? (
        <button
          type="button"
          className="rsvp-notice-action"
          disabled={pending}
          onClick={onReview}
        >
          {notice.section === "events"
            ? "Review events"
            : notice.section === "attendees"
              ? "Review attendees"
              : "Review response"}
        </button>
      ) : null}
    </div>
  );
}
