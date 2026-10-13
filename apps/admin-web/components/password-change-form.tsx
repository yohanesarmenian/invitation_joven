"use client";
import { useRef, useState, type FormEvent } from "react";
import type { AdminAuthResponse } from "@wedding-invitation/api-client/src/index";
import { changeOwnPassword } from "../src/auth/browser-client";

function validPassword(value: string): boolean {
  const length = [...value].length;

  return length >= 15 && length <= 128;
}

export function PasswordChangeForm({ auth }: { auth: AdminAuthResponse }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    setMessage("");

    if (!validPassword(currentPassword) || !validPassword(newPassword)) {
      setMessage("Use 15 to 128 characters for both passwords.");
      return;
    }

    locked.current = true;
    setPending(true);
    const result = await changeOwnPassword(auth.csrfToken, {
      currentPassword,
      newPassword,
    });

    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      window.location.replace(
        auth.user.role === "CHECKIN_STAFF" ? "/checkin" : "/",
      );
      return;
    }

    setMessage(result.message);
    setPending(false);
    locked.current = false;
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <div className="field">
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={pending}
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={pending}
        />
      </div>
      <div aria-live="polite" aria-atomic="true">
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        {pending && <p role="status">Changing password...</p>}
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Changing password..." : "Change password"}
      </button>
    </form>
  );
}
