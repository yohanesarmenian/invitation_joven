"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import {
  archiveInvitation,
  loadPublicUrl,
  regenerateInvitationToken,
  UNCERTAIN_REGENERATION,
} from "../src/invitations/lifecycle";

function Dialog({
  children,
  confirmLabel,
  describedBy,
  heading,
  id,
  onCancel,
  onConfirm,
  pending,
}: {
  children: ReactNode;
  confirmLabel: string;
  describedBy: string;
  heading: string;
  id: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onCancel, pending]);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-describedby={describedBy}
        aria-labelledby={id}
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <h2 id={id}>{heading}</h2>
        <div id={describedBy}>{children}</div>
        <div className="dialog-actions">
          <button
            ref={close}
            className="invitation-secondary"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button disabled={pending} onClick={onConfirm} type="button">
            {pending ? "Working..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function setNotice(
  setMessage: Dispatch<SetStateAction<string>>,
  notice: React.RefObject<HTMLDivElement | null>,
  message: string,
) {
  setMessage(message);
  requestAnimationFrame(() => notice.current?.focus());
}

export function InvitationActions({
  archivedAt,
  csrfToken,
  invitationId,
  publicTokenVersion,
  status,
}: {
  archivedAt: string | null;
  csrfToken: string;
  invitationId: string;
  publicTokenVersion: number;
  status: "ACTIVE" | "ARCHIVED";
}) {
  const [csrf, setCsrf] = useState(csrfToken);
  const [version, setVersion] = useState(publicTokenVersion);
  const [publicUrl, setPublicUrl] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<
    "public-url" | "archive" | "regenerate" | "recover" | null
  >(null);
  const [dialog, setDialog] = useState<"archive" | "regenerate" | null>(null);
  const notice = useRef<HTMLDivElement>(null);
  const active = status === "ACTIVE";

  async function viewPublicUrl(kind: "public-url" | "recover" = "public-url") {
    if (pending) return;
    setPending(kind);
    const result = await loadPublicUrl(invitationId);
    setPending(null);
    if (result.kind === "loaded") {
      setPublicUrl(result.data.publicUrl);
      setVersion(result.data.publicTokenVersion);
      setNotice(setMessage, notice, "Current public link loaded.");
      return;
    }
    if (result.kind === "session-ended") {
      window.location.replace(SESSION_ENDED_PATH);
      return;
    }
    if (result.kind === "archived")
      setNotice(
        setMessage,
        notice,
        "Archived invitations do not have an active public link.",
      );
    else if (result.kind === "not-found")
      setNotice(setMessage, notice, "Invitation was not found.");
    else
      setNotice(
        setMessage,
        notice,
        result.kind === "rejected"
          ? result.message
          : "Unable to load the current public link.",
      );
  }

  async function copyPublicUrl() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice(setMessage, notice, "Copied public link.");
    } catch {
      setNotice(
        setMessage,
        notice,
        "Copy was not available. Select and copy the link manually.",
      );
    }
  }

  async function confirmArchive() {
    if (pending) return;
    setPending("archive");
    const result = await archiveInvitation(invitationId, csrf);
    setPending(null);
    if (result.kind === "archived") {
      window.location.replace(`/invitations/${invitationId}?archived=1`);
      return;
    }
    setDialog(null);
    if (result.kind === "session-ended") {
      window.location.replace(SESSION_ENDED_PATH);
      return;
    }
    if (result.kind === "csrf") {
      setCsrf(result.csrfToken);
      setNotice(setMessage, notice, result.message);
      return;
    }
    setNotice(
      setMessage,
      notice,
      result.kind === "not-found"
        ? "Invitation was not found."
        : result.kind === "conflict"
          ? "The invitation could not be archived in its current state. Reload the latest detail before trying again."
          : result.kind === "rejected"
            ? result.message
            : "The archive result could not be confirmed. Reload the detail before trying again.",
    );
  }

  async function confirmRegenerate() {
    if (pending) return;
    setPending("regenerate");
    const result = await regenerateInvitationToken(invitationId, version, csrf);
    setPending(null);
    setDialog(null);
    if (result.kind === "regenerated") {
      setPublicUrl(result.data.publicUrl);
      setVersion(result.data.publicTokenVersion);
      setNotice(setMessage, notice, "New public link created.");
      return;
    }
    if (result.kind === "session-ended") {
      window.location.replace(SESSION_ENDED_PATH);
      return;
    }
    if (result.kind === "csrf") {
      setCsrf(result.csrfToken);
      setNotice(setMessage, notice, result.message);
      return;
    }
    if (result.kind === "conflict") {
      setNotice(
        setMessage,
        notice,
        "The public link changed elsewhere. Refresh the current public link before regenerating again.",
      );
      return;
    }
    setNotice(
      setMessage,
      notice,
      result.kind === "not-found"
        ? "Invitation was not found."
        : result.kind === "rejected"
          ? result.message
          : UNCERTAIN_REGENERATION,
    );
  }

  return (
    <section className="detail-section lifecycle-section">
      <div className="section-heading">
        <h2>Lifecycle actions</h2>
        <p>
          Public links are sensitive. Load or rotate them only when needed.
        </p>
      </div>
      {archivedAt && (
        <p className="notice" role="status">
          This invitation was archived. Public guest access is unavailable.
        </p>
      )}
      <div ref={notice} tabIndex={-1} role={message ? "alert" : undefined}>
        {message && <p className="notice">{message}</p>}
      </div>
      <div className="lifecycle-actions">
        <button
          className="invitation-secondary"
          disabled={!active || pending !== null}
          onClick={() => viewPublicUrl()}
          type="button"
        >
          {pending === "public-url" ? "Loading..." : "View public link"}
        </button>
        <button
          className="danger-secondary"
          disabled={!active || pending !== null}
          onClick={() => setDialog("regenerate")}
          type="button"
        >
          Regenerate public link
        </button>
        <button
          className="danger-secondary"
          disabled={!active || pending !== null}
          onClick={() => setDialog("archive")}
          type="button"
        >
          Archive invitation
        </button>
      </div>
      {publicUrl && (
        <div className="public-url-control">
          <label htmlFor="publicUrl">Current public link</label>
          <textarea id="publicUrl" readOnly rows={3} value={publicUrl} />
          <p className="hint">Current token version: {version}</p>
          <button
            className="invitation-secondary"
            disabled={pending !== null}
            onClick={copyPublicUrl}
            type="button"
          >
            Copy public link
          </button>
        </div>
      )}
      {message === UNCERTAIN_REGENERATION && (
        <button
          className="invitation-secondary"
          disabled={pending !== null}
          onClick={() => viewPublicUrl("recover")}
          type="button"
        >
          {pending === "recover" ? "Refreshing..." : "Refresh current link"}
        </button>
      )}
      {dialog === "archive" && (
        <Dialog
          confirmLabel="Archive invitation"
          describedBy="archive-desc"
          heading="Archive invitation"
          id="archive-title"
          onCancel={() => setDialog(null)}
          onConfirm={confirmArchive}
          pending={pending === "archive"}
        >
          <p>
            The public invitation, RSVP, guest message submission, and public
            check-in access will stop resolving. Admin history remains
            available.
          </p>
        </Dialog>
      )}
      {dialog === "regenerate" && (
        <Dialog
          confirmLabel="Regenerate public link"
          describedBy="regenerate-desc"
          heading="Regenerate public link"
          id="regenerate-title"
          onCancel={() => setDialog(null)}
          onConfirm={confirmRegenerate}
          pending={pending === "regenerate"}
        >
          <p>
            The current invitation link will stop working immediately on
            success. A new public link will be created, and anyone with the old
            link must receive the new one.
          </p>
        </Dialog>
      )}
    </section>
  );
}
