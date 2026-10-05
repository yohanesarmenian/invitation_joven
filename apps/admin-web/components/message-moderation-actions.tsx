"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  moderateGuestMessage,
  UNCERTAIN_MESSAGE_MODERATION,
  type ModerateMessageResult,
} from "../src/messages/moderation";

function messageForResult(result: ModerateMessageResult) {
  switch (result.kind) {
    case "csrf":
    case "rejected":
      return result.message;
    case "validation":
      return "The message visibility request was rejected. Reload the list before trying again.";
    case "not-found":
      return "This message was not found. Reload the list to refresh the current state.";
    case "session-ended":
      return "Your admin session has ended. Sign in again before changing messages.";
    case "uncertain":
      return UNCERTAIN_MESSAGE_MODERATION;
    case "updated":
      return result.data.isHidden
        ? "Message hidden. Reloading the authoritative list."
        : "Message unhidden. Reloading the authoritative list.";
  }
}

export function MessageModerationActions({
  csrfToken,
  isHidden,
  messageId,
  refreshHref,
}: {
  csrfToken: string;
  isHidden: boolean;
  messageId: string;
  refreshHref: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState(csrfToken);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const targetHidden = !isHidden;
  const action = targetHidden ? "Hide message" : "Unhide message";

  async function confirm() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const result = await moderateGuestMessage(
      messageId,
      { isHidden: targetHidden },
      token,
    );
    pendingRef.current = false;
    setPending(false);
    setMessage(messageForResult(result));
    setTimeout(() => noticeRef.current?.focus(), 0);
    if (result.kind === "csrf") setToken(result.csrfToken);
    if (result.kind === "session-ended") router.push("/login?session=ended");
    if (result.kind === "updated") router.replace(refreshHref);
  }

  return (
    <div className="message-moderation">
      <button
        type="button"
        className="message-action"
        onClick={() => dialogRef.current?.showModal()}
        disabled={pending}
      >
        {action}
      </button>
      <div
        ref={noticeRef}
        tabIndex={-1}
        role={message ? "alert" : undefined}
        className="message-action-notice"
      >
        {message}
      </div>
      {message === UNCERTAIN_MESSAGE_MODERATION && (
        <a className="dashboard-retry" href={refreshHref}>
          Reload message list
        </a>
      )}
      <dialog ref={dialogRef} aria-label={action}>
        <form method="dialog" className="confirm-dialog">
          <h3>{action}</h3>
          <p>
            This changes only the admin moderation visibility flag. The original
            guest-authored message text is preserved.
          </p>
          <div className="invitation-actions">
            <button
              type="button"
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? "Saving..." : action}
            </button>
            <button type="submit" className="invitation-secondary">
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
