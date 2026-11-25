"use client";

export default function PublicInvitationError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      className="public-invitation-error"
      aria-labelledby="invitation-error-title"
    >
      <h1 id="invitation-error-title">Undangan belum bisa dimuat</h1>
      <p>Silakan coba lagi sebentar lagi.</p>
      <button type="button" onClick={reset}>
        Coba Lagi
      </button>
    </main>
  );
}
