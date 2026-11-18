"use client";
import { ActionFeedback } from "./action-feedback";
import { useRef, useState, type FormEvent } from "react";
import { SESSION_ENDED, validateLogin } from "../src/auth/auth-state";
import { signIn } from "../src/auth/browser-client";
export function LoginForm({
  sessionEnded = false,
  initialNotice,
}: {
  sessionEnded?: boolean;
  initialNotice?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<
    Partial<Record<"email" | "password", string>>
  >({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const validation = validateLogin(email, password);
    setFields(validation.fields);
    setMessage("");
    if (validation.fields.email || validation.fields.password) {
      (validation.fields.email ? emailInput : passwordInput).current?.focus();
      return;
    }
    locked.current = true;
    setPending(true);
    const result = await signIn(validation.body);
    if (result.ok) {
      setPassword("");
      // Full navigation discards prior route/session state; the server checks /me again.
      window.location.replace(
        result.auth.user.mustChangePassword
          ? "/account/password"
          : result.auth.user.role === "GUEST_MANAGER"
            ? "/reception"
            : result.auth.user.role !== "OWNER"
              ? "/checkin"
              : "/",
      );
      return;
    }
    setMessage(result.message);
    setPending(false);
    locked.current = false;
  }
  return (
    <form
      onSubmit={submit}
      method="post"
      action="/api/admin/auth/login"
      noValidate
      aria-busy={pending}
    >
      {sessionEnded && (
        <p className="notice" role="status">
          {SESSION_ENDED}
        </p>
      )}
      {initialNotice && (
        <p className="notice" role="status">
          {initialNotice}
        </p>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          ref={emailInput}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          aria-invalid={!!fields.email}
          aria-describedby={fields.email ? "email-error" : undefined}
        />
        {fields.email && (
          <p id="email-error" className="field-error" role="alert">
            {fields.email}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          ref={passwordInput}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          aria-invalid={!!fields.password}
          aria-describedby={
            fields.password ? "password-hint password-error" : "password-hint"
          }
        />
        <p id="password-hint" className="hint">
          15 to 128 characters. Spaces count.
        </p>
        {fields.password && (
          <p id="password-error" className="field-error" role="alert">
            {fields.password}
          </p>
        )}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {message && <ActionFeedback tone="error">{message}</ActionFeedback>}
        {pending && <p role="status">Signing in…</p>}
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
