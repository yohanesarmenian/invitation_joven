"use client";
import { ActionFeedback, type FeedbackTone } from "./action-feedback";
import { useEffect, useRef, useState } from "react";
import { loadPublicUrl } from "../src/invitations/lifecycle";
import {
  personalMessage,
  type MessageContext,
} from "../src/invitations/personal-message";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
export function PersonalInviteMessage({
  invitationId,
  context,
}: {
  invitationId: string;
  context: MessageContext;
}) {
  const [text, setText] = useState(""),
    [url, setUrl] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false),
    lock = useRef(false),
    field = useRef<HTMLTextAreaElement>(null);
  const [tone, setTone] = useState<FeedbackTone>("info");
  useEffect(() => {
    const clear = () => {
      setText("");
      setUrl("");
    };
    window.addEventListener("pagehide", clear);
    window.addEventListener("admin:signout", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("admin:signout", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  async function prepare(copy = false) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setTone("info");
    setNotice("");
    const result = await loadPublicUrl(invitationId);
    lock.current = false;
    setPending(false);
    if (result.kind !== "loaded") {
      setText("");
      setUrl("");
      if (result.kind === "session-ended")
        window.location.replace(SESSION_ENDED_PATH);
      else {
        setTone("error");
        setNotice(
          "Unable to read the current invitation link. Refresh and check the invitation status.",
        );
      }
      return;
    }
    const current = result.data.publicUrl;
    if (!copy || current !== url) {
      setUrl(current);
      setText(personalMessage(context, current));
      setTone(copy ? "warning" : "info");
      setNotice(
        copy
          ? "The invitation link changed. Review the rebuilt preview, then copy explicitly."
          : "Review the wording before copying. This action does not send a message.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setTone("success");
      setNotice(
        "Personal invitation message copied. Send it yourself using your preferred app.",
      );
    } catch {
      setTone("warning");
      field.current?.focus();
      field.current?.select();
      setNotice(
        "Clipboard unavailable. The preview is selected for manual copying.",
      );
    }
  }
  return (
    <section className="detail-section">
      <h2>Personal invitation message</h2>
      <p>
        Prepare and copy a message for this household. Links remain private;
        nothing is sent automatically.
      </p>
      <button disabled={pending} onClick={() => void prepare()}>
        Prepare personal message
      </button>
      {text && (
        <>
          <label htmlFor="personal-message">Message preview</label>
          <textarea
            ref={field}
            id="personal-message"
            rows={12}
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
          />
          <button disabled={pending} onClick={() => void prepare(true)}>
            Copy personal message
          </button>
          <button
            disabled={pending}
            onClick={() => {
              setText("");
              setUrl("");
            }}
          >
            Dismiss message preview
          </button>
        </>
      )}
      <ActionFeedback tone={tone}>{notice}</ActionFeedback>
    </section>
  );
}
