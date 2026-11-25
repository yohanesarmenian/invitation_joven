"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { SubmitPublicGuestMessageRequest } from "../../../../packages/api-client/src/index";
import {
  guestMessageFailureText,
  messageCharacterCount,
  prepareGuestMessage,
  type GuestMessageReceipt,
  type GuestMessageResult,
} from "../../src/messages/state";
import Image from "next/image";
import { figmaAssets } from "../../src/presentation/figma-assets";

export function GuestMessageForm({
  submitAction,
  receiptAction,
  receiptKey,
}: {
  submitAction: (
    request: SubmitPublicGuestMessageRequest,
  ) => Promise<GuestMessageResult>;
  receiptAction?: (submissionId: string) => Promise<GuestMessageReceipt>;
  receiptKey?: string;
}) {
  const id = useId();
  const [authorName, setAuthorName] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<
    "checking" | "unverified" | "idle" | "pending" | "success"
  >(receiptKey ? "checking" : "idle");
  const [failure, setFailure] = useState<Extract<
    GuestMessageResult,
    { status: "error" }
  > | null>(null);
  const [validation, setValidation] = useState<Extract<
    ReturnType<typeof prepareGuestMessage>,
    { status: "invalid" }
  > | null>(null);
  const inFlight = useRef(false);
  const focusReceipt = useRef(false);
  const focusNewDraft = useRef(false);
  const pendingId = useRef<string | null>(null);
  const savedId = useRef<string | null>(null);
  const uncertainRequest = useRef<SubmitPublicGuestMessageRequest | null>(null);
  const authorRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const pending = state === "pending";

  const checkReceipt = useCallback(async () => {
    setState("checking");
    let submissionId = pendingId.current;
    try {
      if (!submissionId && receiptKey)
        submissionId = localStorage.getItem(receiptKey);
    } catch {
      // Storage can be unavailable. The current visit still supports safe retry.
    }
    if (
      !submissionId ||
      !receiptAction ||
      !/^[0-9a-f-]{36}$/.test(submissionId)
    ) {
      setState("idle");
      return;
    }
    pendingId.current = submissionId;
    const receipt = await receiptAction(submissionId).catch(() => "unverified");
    if (receipt === "saved") {
      savedId.current = submissionId;
      pendingId.current = null;
      uncertainRequest.current = null;
      setAuthorName("");
      setMessage("");
      setFailure(null);
      setState("success");
    } else {
      setState(
        receipt === "missing" || uncertainRequest.current
          ? "idle"
          : "unverified",
      );
    }
  }, [receiptAction, receiptKey]);

  useEffect(() => {
    if (receiptKey) void Promise.resolve().then(checkReceipt);
  }, [checkReceipt, receiptKey]);

  function rememberReceipt(submissionId: string | null) {
    if (!receiptKey) return;
    try {
      if (submissionId) localStorage.setItem(receiptKey, submissionId);
      else localStorage.removeItem(receiptKey);
    } catch {
      // No guest text or invitation credential is written to browser storage.
    }
  }

  useEffect(() => {
    if (state === "success" && focusReceipt.current) {
      focusReceipt.current = false;
      successRef.current?.focus();
    }
  }, [state]);

  useLayoutEffect(() => {
    if (state === "idle" && focusNewDraft.current) {
      focusNewDraft.current = false;
      authorRef.current?.focus();
    }
  }, [state]);

  useEffect(() => {
    if (validation?.authorName) authorRef.current?.focus();
    else if (validation?.message) messageRef.current?.focus();
  }, [validation]);

  useEffect(() => {
    if (failure) errorRef.current?.focus();
  }, [failure]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || state !== "idle") return;
    const prepared = prepareGuestMessage(authorName, message);
    if (prepared.status === "invalid") {
      setValidation(prepared);
      return;
    }
    inFlight.current = true;
    const wasUncertain = pendingId.current !== null;
    const submissionId = pendingId.current ?? crypto.randomUUID();
    const request = uncertainRequest.current ?? {
      ...prepared.request,
      submissionId,
    };
    pendingId.current = submissionId;
    rememberReceipt(submissionId);
    setValidation(null);
    setFailure(null);
    setState("pending");
    try {
      const result = await submitAction(request);
      if (result.status === "success") {
        focusReceipt.current = true;
        savedId.current = submissionId;
        pendingId.current = null;
        uncertainRequest.current = null;
        setAuthorName("");
        setMessage("");
        setState("success");
      } else {
        if (wasUncertain || result.kind === "uncertain") {
          uncertainRequest.current = request;
          setFailure({ status: "error", kind: "uncertain" });
        } else {
          pendingId.current = null;
          rememberReceipt(savedId.current);
          setFailure(result);
        }
        setState("idle");
      }
    } catch {
      uncertainRequest.current = request;
      setFailure({ status: "error", kind: "uncertain" });
      setState("idle");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="guest-message-form">
      <h2 id="message-title" ref={successRef} tabIndex={-1}>
        {state === "success"
          ? "Terima kasih atas ucapan Anda"
          : "Tulis Ucapan untuk Kedua Mempelai"}
      </h2>
      <div role="status" aria-atomic="true">
        {state === "success" ? (
          <div className="guest-message-confirmation">
            <Image
              className="figma-message-icon"
              src={figmaAssets["82_113_LoveLetterIcon"]}
              alt=""
              width={67}
              height={44}
            />
            <p>Ucapan Anda telah tersimpan untuk kedua mempelai.</p>
            <button
              type="button"
              onClick={() => {
                const hero = document.getElementById("invitation-hero-title");
                hero?.focus({ preventScroll: true });
                hero?.scrollIntoView({ block: "center" });
              }}
            >
              Kembali ke Undangan
            </button>
            <button
              type="button"
              onClick={() => {
                focusNewDraft.current = true;
                setState("idle");
              }}
            >
              Tulis Ucapan Lain
            </button>
          </div>
        ) : pending ? (
          "Mengirim ucapan Anda…"
        ) : state === "checking" ? (
          "Memeriksa ucapan Anda…"
        ) : state === "unverified" ? (
          <div>
            <p>
              Kami belum dapat memeriksa apakah ucapan Anda tersimpan. Silakan
              periksa kembali sebelum menulis ucapan lain.
            </p>
            <button type="button" onClick={() => void checkReceipt()}>
              Periksa Lagi
            </button>
          </div>
        ) : null}
      </div>
      {(state === "idle" || pending) && (
        <form
          aria-label="Ucapan untuk mempelai"
          aria-busy={pending}
          aria-describedby={failure ? `${id}-error` : undefined}
          onSubmit={submit}
          noValidate
        >
          {failure ? (
            <p
              id={`${id}-error`}
              className="guest-message-error"
              role="alert"
              ref={errorRef}
              tabIndex={-1}
            >
              {guestMessageFailureText(failure.kind)}
            </p>
          ) : null}
          <fieldset disabled={pending}>
            <legend className="visually-hidden">Tulis ucapan</legend>
            <label htmlFor={`${id}-author`}>
              Nama Anda <span>(opsional)</span>
            </label>
            <input
              id={`${id}-author`}
              ref={authorRef}
              type="text"
              value={authorName}
              readOnly={failure?.kind === "uncertain"}
              autoComplete="off"
              aria-invalid={Boolean(validation?.authorName)}
              aria-describedby={`${id}-author-limit${validation?.authorName ? ` ${id}-author-error` : ""}`}
              onChange={(event) => {
                if (!inFlight.current) {
                  setAuthorName(event.target.value);
                  setValidation(null);
                }
              }}
            />
            <p id={`${id}-author-limit`} className="guest-message-limit">
              Maksimal 100 karakter, di luar spasi pada awal dan akhir.
            </p>
            {validation?.authorName ? (
              <p
                id={`${id}-author-error`}
                className="guest-message-error"
                role="alert"
              >
                {validation.authorName}
              </p>
            ) : null}
            <label htmlFor={`${id}-message`}>
              Ucapan Anda <span>(wajib)</span>
            </label>
            <textarea
              id={`${id}-message`}
              ref={messageRef}
              rows={6}
              required
              value={message}
              readOnly={failure?.kind === "uncertain"}
              aria-invalid={Boolean(validation?.message)}
              aria-describedby={`${id}-message-limit${validation?.message ? ` ${id}-message-error` : ""}`}
              onChange={(event) => {
                if (!inFlight.current) {
                  setMessage(event.target.value);
                  setValidation(null);
                }
              }}
            />
            <p id={`${id}-message-limit`} className="guest-message-limit">
              {messageCharacterCount(message).toLocaleString("id-ID")} / 1.000
              karakter, di luar spasi pada awal dan akhir.
            </p>
            {validation?.message ? (
              <p
                id={`${id}-message-error`}
                className="guest-message-error"
                role="alert"
              >
                {validation.message}
              </p>
            ) : null}
            <button type="submit" disabled={pending}>
              {pending
                ? "Mengirim…"
                : failure?.kind === "uncertain"
                  ? "Kirim Ulang Ucapan yang Sama"
                  : failure
                    ? "Coba Kirim Ucapan Lagi"
                    : "Kirim Ucapan"}
            </button>
            {failure?.kind === "uncertain" && receiptAction && (
              <button type="button" onClick={() => void checkReceipt()}>
                Periksa Ucapan
              </button>
            )}
          </fieldset>
        </form>
      )}
    </div>
  );
}
