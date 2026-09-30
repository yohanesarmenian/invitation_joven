"use client";
import { useRef, useState } from "react";
import { signOut } from "../src/auth/browser-client";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
export function LogoutButton({ csrfToken }: { csrfToken: string }) {
  const [token, setToken] = useState(csrfToken);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(false);
  const locked = useRef(false);
  async function logout() {
    if (locked.current || reload) return;
    locked.current = true;
    setPending(true);
    setMessage("");
    const result = await signOut(token);
    if (result.kind === "signed-out" || result.kind === "session-ended") {
      setToken("");
      window.location.replace(
        result.kind === "signed-out" ? "/login" : SESSION_ENDED_PATH,
      );
      return;
    }
    if (result.kind === "retry") {
      setToken(result.csrfToken);
      setMessage(
        "Your session has been refreshed. Select Sign out again to continue.",
      );
    } else if (result.kind === "failure") {
      setReload(!!result.reload);
      setMessage(result.message);
    }
    setPending(false);
    locked.current = false;
  }
  return (
    <div className="logout">
      <button type="button" onClick={logout} disabled={pending || reload}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      <div role="status" aria-live="polite">
        {pending ? "Signing out…" : message}
      </div>
      {reload && (
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      )}
    </div>
  );
}
