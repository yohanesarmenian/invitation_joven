"use client";

export default function PublicInvitationError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main aria-labelledby="invitation-error-title">
      <h1 id="invitation-error-title">Unable to load the invitation</h1>
      <p>Please try again in a moment.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
