"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { SubmitPublicGuestMessageRequest } from "../../../../packages/api-client/src/index";
import {
  guestMessageFailureText,
  messageCharacterCount,
  prepareGuestMessage,
  type GuestMessageResult,
} from "../../src/messages/state";
import Image from "next/image";
import { figmaAssets } from "../../src/presentation/figma-assets";

export function GuestMessageForm({
  submitAction,
}: {
  submitAction: (
    request: SubmitPublicGuestMessageRequest,
  ) => Promise<GuestMessageResult>;
}) {
  const id = useId();
  const [authorName, setAuthorName] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<
    "idle" | "pending" | "success" | "returned"
  >("idle");
  const [failure, setFailure] = useState<Extract<
    GuestMessageResult,
    { status: "error" }
  > | null>(null);
  const [validation, setValidation] = useState<Extract<
    ReturnType<typeof prepareGuestMessage>,
    { status: "invalid" }
  > | null>(null);
  const inFlight = useRef(false);
  const authorRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const pending = state === "pending";

  useEffect(() => {
    if (state === "success") successRef.current?.focus();
    else if (state === "returned") authorRef.current?.focus();
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
    if (inFlight.current || state === "success") return;
    const prepared = prepareGuestMessage(authorName, message);
    if (prepared.status === "invalid") {
      setValidation(prepared);
      return;
    }
    inFlight.current = true;
    setValidation(null);
    setFailure(null);
    setState("pending");
    try {
      const result = await submitAction(prepared.request);
      if (result.status === "success") {
        setAuthorName("");
        setMessage("");
        setState("success");
      } else {
        setFailure(result);
        setState("idle");
      }
    } catch {
      setFailure({ status: "error", kind: "uncertain" });
      setState("idle");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="guest-message-form">
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
            <h3 ref={successRef} tabIndex={-1}>
              Message Sent!
            </h3>
            <p>
              Thank you for your message. The bride and groom look forward to
              reading all your warm wishes after the celebration.
            </p>
            <button type="button" onClick={() => setState("returned")}>
              Back to Invitation
            </button>
          </div>
        ) : pending ? (
          "Sending your message…"
        ) : null}
      </div>
      {state !== "success" && (
        <form
          aria-label="Guest message"
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
            <legend className="visually-hidden">Leave a message</legend>
            <label htmlFor={`${id}-author`}>
              Your name <span>(optional)</span>
            </label>
            <input
              id={`${id}-author`}
              ref={authorRef}
              type="text"
              value={authorName}
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
              Up to 100 characters, excluding outer spaces.
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
              Your message <span>(required)</span>
            </label>
            <textarea
              id={`${id}-message`}
              ref={messageRef}
              rows={6}
              required
              value={message}
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
              {messageCharacterCount(message)} / 1000 characters, excluding
              outer spaces.
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
                ? "Sending…"
                : failure
                  ? "Send Message Again"
                  : "Send Message"}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}
