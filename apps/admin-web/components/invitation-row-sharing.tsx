"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { useHydrated } from "../src/invitations/use-hydrated";
import {
  safeInvitationUrl,
  whatsappInvitationUrl,
} from "../src/invitations/create-workflow";
import { loadPublicUrl } from "../src/invitations/lifecycle";
import { ActionFeedback, type FeedbackTone } from "./action-feedback";

// The clipboard is shared across rows. Keep copy operations in user-visible order.
let copyInFlight: AbortController | null = null;

export function InvitationRowSharing({
  invitationId,
  publicInvitationOrigin,
  showPersonalMessage = true,
}: {
  invitationId: string;
  publicInvitationOrigin: string;
  showPersonalMessage?: boolean;
}) {
  const request = useRef<AbortController | null>(null);
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [prepared, setPrepared] = useState<{
    link: string;
    action: "copy" | "whatsapp";
  }>();
  const [feedback, setFeedback] = useState<{
    tone: FeedbackTone;
    message: string;
  }>();

  useEffect(() => {
    function clear() {
      request.current?.abort();
      request.current = null;
      setPrepared(undefined);
      setFeedback(undefined);
      setPending(false);
    }
    function hide() {
      if (document.visibilityState === "hidden") clear();
    }
    window.addEventListener("pagehide", clear);
    window.addEventListener("admin:signout", clear);
    document.addEventListener("visibilitychange", hide);
    return () => {
      request.current?.abort();
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("admin:signout", clear);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  async function share(action: "copy" | "whatsapp") {
    if (request.current) return;
    if (action === "copy" && copyInFlight) {
      setFeedback({
        tone: "info",
        message:
          "Another link is being copied. Try this household again when it finishes.",
      });
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    if (action === "copy") copyInFlight = controller;
    setPending(true);
    setPrepared(undefined);
    setFeedback(undefined);
    try {
      const result = await loadPublicUrl(invitationId, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind === "session-ended") {
        window.location.replace(SESSION_ENDED_PATH);
        return;
      }
      if (
        result.kind !== "loaded" ||
        !safeInvitationUrl(result.data.publicUrl) ||
        new URL(result.data.publicUrl).origin !== publicInvitationOrigin
      ) {
        const message =
          result.kind === "archived"
            ? "This invitation is now archived. Refresh the list."
            : result.kind === "rejected"
              ? result.message
              : "The current invitation link could not be verified.";
        setFeedback({ tone: "error", message });
        return;
      }
      const link = result.data.publicUrl;
      if (action === "whatsapp") {
        setPrepared({ link, action });
        setFeedback({
          tone: "info",
          message: "Review the recipient in WhatsApp before sending.",
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        if (!controller.signal.aborted)
          setFeedback({ tone: "success", message: "Invitation link copied." });
      } catch {
        if (controller.signal.aborted) return;
        setPrepared({ link, action });
        setFeedback({
          tone: "warning",
          message: "Clipboard unavailable. Select and copy the link manually.",
        });
      }
    } finally {
      if (copyInFlight === controller) copyInFlight = null;
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div className="invitation-row-sharing">
      <button
        type="button"
        disabled={!hydrated}
        aria-disabled={pending}
        onClick={() => void share("copy")}
      >
        Copy link
      </button>
      <button
        type="button"
        disabled={!hydrated}
        aria-disabled={pending}
        onClick={() => void share("whatsapp")}
      >
        Prepare WhatsApp
      </button>
      {showPersonalMessage && (
        <Link href={`/invitations/${invitationId}#sharing`} prefetch={false}>
          Personal message
        </Link>
      )}
      {pending && <p role="status">Loading current link…</p>}
      {prepared?.action === "copy" && (
        <label>
          Current link
          <input
            readOnly
            value={prepared.link}
            onFocus={(event) => event.currentTarget.select()}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      {prepared?.action === "whatsapp" && (
        <a
          href={whatsappInvitationUrl(prepared.link)!}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open WhatsApp
        </a>
      )}
      {prepared && (
        <button
          type="button"
          onClick={() => {
            setPrepared(undefined);
            setFeedback(undefined);
          }}
        >
          Dismiss prepared link
        </button>
      )}
      {feedback && (
        <ActionFeedback tone={feedback.tone}>{feedback.message}</ActionFeedback>
      )}
    </div>
  );
}
