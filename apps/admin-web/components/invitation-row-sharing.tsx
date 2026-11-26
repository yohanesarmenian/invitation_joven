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
let handoffInFlight: AbortController | null = null;

type PreparedLink =
  | { action: "copy"; link: string }
  | { action: "whatsapp"; link: string; version: number };

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
  const [prepared, setPrepared] = useState<PreparedLink>();
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
      clear();
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("admin:signout", clear);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  async function share(action: "copy" | "whatsapp" | "handoff") {
    if (request.current) return;
    if (action === "handoff" && prepared?.action !== "whatsapp") return;
    if (action === "handoff" && handoffInFlight) {
      setFeedback({
        tone: "info",
        message:
          "Another WhatsApp link is being checked. Try again when it finishes.",
      });
      return;
    }
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
    if (action === "handoff") handoffInFlight = controller;
    setPending(true);
    if (action !== "handoff") setPrepared(undefined);
    setFeedback(undefined);
    try {
      const timeout = window.setTimeout(
        () => controller.abort("timeout"),
        20_000,
      );
      const result = await loadPublicUrl(
        invitationId,
        controller.signal,
      ).finally(() => window.clearTimeout(timeout));
      if (controller.signal.aborted) {
        if (
          request.current === controller &&
          controller.signal.reason === "timeout"
        ) {
          setPrepared(undefined);
          setFeedback({
            tone: "error",
            message:
              "Checking the current invitation link timed out. Try again.",
          });
        }
        return;
      }
      if (result.kind === "session-ended") {
        setPrepared(undefined);
        window.location.replace(SESSION_ENDED_PATH);
        return;
      }
      if (
        result.kind !== "loaded" ||
        !safeInvitationUrl(result.data.publicUrl) ||
        new URL(result.data.publicUrl).origin !== publicInvitationOrigin
      ) {
        setPrepared(undefined);
        const message =
          result.kind === "archived"
            ? "This invitation is now archived. Refresh the list."
            : result.kind === "not-found"
              ? "This invitation could not be found."
              : result.kind === "rejected"
                ? result.message
                : "The current invitation link could not be verified.";
        setFeedback({ tone: "error", message });
        return;
      }
      const link = result.data.publicUrl;
      const version = result.data.publicTokenVersion;
      if (action === "whatsapp") {
        setPrepared({ link, version, action });
        setFeedback({
          tone: "info",
          message:
            "WhatsApp will open in this tab. Review the recipient before sending.",
        });
        return;
      }
      if (action === "handoff") {
        if (prepared?.action !== "whatsapp") return;
        if (prepared.link !== link || prepared.version !== version) {
          setPrepared({ link, version, action: "whatsapp" });
          setFeedback({
            tone: "warning",
            message:
              "The invitation link changed. Confirm again to open WhatsApp with the updated link.",
          });
          return;
        }
        const href = whatsappInvitationUrl(link);
        if (!href) return;

        // Same-tab navigation works after the authorized read without a popup.
        const handoff = document.createElement("a");
        handoff.href = href;
        handoff.target = "_self";
        handoff.rel = "noopener noreferrer";
        setPrepared(undefined);
        handoff.click();
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
      if (handoffInFlight === controller) handoffInFlight = null;
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
        <button
          type="button"
          disabled={!hydrated}
          aria-disabled={pending}
          onClick={() => void share("handoff")}
        >
          Open WhatsApp
        </button>
      )}
      {prepared && (
        <button
          type="button"
          disabled={pending}
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
