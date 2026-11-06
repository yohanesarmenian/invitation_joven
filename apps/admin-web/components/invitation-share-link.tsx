"use client";
import { useState } from "react";
import {
  safeInvitationUrl,
  whatsappInvitationUrl,
} from "../src/invitations/create-workflow";

export function InvitationShareLink({ publicUrl }: { publicUrl: string }) {
  const [message, setMessage] = useState("");
  if (!safeInvitationUrl(publicUrl))
    return (
      <p role="alert">
        The invitation link could not be verified. Open the invitation details
        and load its current link before sharing.
      </p>
    );
  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage("Invitation link copied.");
    } catch {
      setMessage(
        "Clipboard access is unavailable. Select and copy the invitation link below.",
      );
    }
  }
  return (
    <div className="invitation-share">
      <label htmlFor="created-public-url">Public invitation link</label>
      <input
        id="created-public-url"
        readOnly
        value={publicUrl}
        onFocus={(event) => event.currentTarget.select()}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="hint">
        Anyone with this link can open this household invitation. Share it only
        with the intended guests.
      </p>
      <div className="invitation-actions">
        <button type="button" onClick={copy}>
          Copy Link
        </button>
        <a
          className="invitation-secondary"
          href={whatsappInvitationUrl(publicUrl)!}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Share on WhatsApp
        </a>
        <a
          className="invitation-secondary"
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Open invitation
        </a>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
