"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type {
  PublicRsvpMutationResponse,
  PublicRsvpReadResponse,
  SubmitPublicRsvpRequest,
} from "../../../../packages/api-client/src/index";
import type { RsvpFailure, RsvpResult } from "../../src/rsvp/result";
import {
  rsvpFailureNotice,
  rsvpLoadFailureNotice,
  rsvpSuccessNotice,
  type RsvpNotice,
} from "../../src/rsvp/notice";
import { RsvpResultNotice } from "./rsvp-result-notice";
import {
  attendeeTotal,
  createRsvpDraft,
  normalizeEventCounts,
  toRsvpRequest,
  validateRsvpDraft,
  type RsvpDraft,
  type RsvpInvitation,
} from "./public-rsvp-state";

export type PublicRsvpFormProps = {
  invitation: RsvpInvitation;
  initialResult: RsvpResult<PublicRsvpReadResponse>;
  submitAction: (
    request: SubmitPublicRsvpRequest,
  ) => Promise<RsvpResult<PublicRsvpMutationResponse>>;
  reloadAction: () => Promise<RsvpResult<PublicRsvpReadResponse>>;
};

export function PublicRsvpForm({
  invitation,
  initialResult,
  submitAction,
  reloadAction,
}: PublicRsvpFormProps) {
  const id = useId();
  const [canonical, setCanonical] = useState(
    initialResult.status === "success" ? initialResult.data.rsvp : null,
  );
  const [draft, setDraft] = useState(() =>
    createRsvpDraft(invitation, canonical),
  );
  const [loaded, setLoaded] = useState(initialResult.status === "success");
  const [operation, setOperation] = useState<"submit" | "reload" | null>(null);
  const [feedback, setFeedback] = useState<"saved" | "reloaded" | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    error: RsvpFailure;
    source: "submit" | "reload";
  } | null>(
    initialResult.status === "error"
      ? { error: initialResult.error, source: "reload" }
      : null,
  );
  // A failed reload must not remove a conflict's submission lock.
  const [lock, setLock] = useState<
    "conflict" | "closed" | "unavailable" | null
  >(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const attendanceRef = useRef<HTMLFieldSetElement>(null);
  const attendeesRef = useRef<HTMLFieldSetElement>(null);
  const eventsRef = useRef<HTMLFieldSetElement>(null);
  const total = attendeeTotal(draft);
  const pending = operation !== null;
  const terminal = lock === "closed" || lock === "unavailable";
  const notice: RsvpNotice | null = validation
    ? {
        tone: "error",
        title: "Please review your response",
        message: validation,
        recovery: "none",
      }
    : failure
      ? failure.source === "reload"
        ? rsvpLoadFailureNotice(failure.error, loaded)
        : rsvpFailureNotice(failure.error)
      : null;
  const submitBlocked =
    pending || !loaded || lock !== null || notice?.recovery === "correct";
  const savedNotice =
    feedback === "saved" &&
    (canonical?.status === "ACCEPTED" || canonical?.status === "DECLINED")
      ? rsvpSuccessNotice(canonical.status)
      : null;

  useEffect(() => {
    if (failure || validation) errorRef.current?.focus();
    else if (feedback === "reloaded") statusRef.current?.focus();
  }, [failure, validation, feedback]);

  function edit(next: RsvpDraft, compositionChanged = false) {
    if (inFlight.current || terminal) return;
    setDraft(compositionChanged ? normalizeEventCounts(next) : next);
    setValidation(null);
    if (lock === null) setFailure(null);
    setFeedback(null);
  }

  function recordFailure(error: RsvpFailure, source: "submit" | "reload") {
    setFailure({ error, source });
    if (error.kind !== "api") return;
    if (error.httpStatus === 409 && error.code === "RSVP_VERSION_CONFLICT")
      setLock("conflict");
    if (error.httpStatus === 422 && error.code === "RSVP_DEADLINE_PASSED")
      setLock("closed");
    if (error.httpStatus === 404 && error.code === "INVITATION_NOT_AVAILABLE")
      setLock("unavailable");
  }

  async function reload() {
    if (inFlight.current || lock === "closed") return;
    inFlight.current = true;
    setOperation("reload");
    setFeedback(null);
    setValidation(null);
    try {
      const result = await reloadAction();
      if (result.status === "error") recordFailure(result.error, "reload");
      else {
        setCanonical(result.data.rsvp);
        setDraft(createRsvpDraft(invitation, result.data.rsvp));
        setLoaded(true);
        setLock(null);
        setFailure(null);
        setFeedback("reloaded");
      }
    } catch {
      recordFailure(
        { kind: "network", httpStatus: null, code: null },
        "reload",
      );
    } finally {
      inFlight.current = false;
      setOperation(null);
    }
  }

  function review() {
    const section = notice?.section;
    const target =
      section === "events"
        ? eventsRef
        : section === "attendees"
          ? attendeesRef
          : attendanceRef;
    (target.current ?? attendanceRef.current)?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || submitBlocked) return;
    const invalid = validateRsvpDraft(draft, invitation);
    if (invalid) {
      setValidation(invalid);
      return;
    }
    inFlight.current = true;
    setOperation("submit");
    setFeedback(null);
    setValidation(null);
    setFailure(null);
    try {
      const result = await submitAction(
        toRsvpRequest(draft, canonical?.version ?? null),
      );
      if (result.status === "error") {
        recordFailure(result.error, "submit");
      } else {
        setCanonical(result.data.rsvp);
        setDraft(createRsvpDraft(invitation, result.data.rsvp));
        setFeedback("saved");
      }
    } catch {
      recordFailure(
        { kind: "network", httpStatus: null, code: null },
        "submit",
      );
    } finally {
      inFlight.current = false;
      setOperation(null);
    }
  }

  const errorNotice = notice ? (
    <RsvpResultNotice
      notice={notice}
      id={`${id}-error`}
      noticeRef={errorRef}
      pending={pending}
      onReload={reload}
      onReview={review}
    />
  ) : null;
  const statusNotice = (
    <div
      role="status"
      aria-atomic="true"
      ref={statusRef}
      tabIndex={-1}
      className={
        savedNotice || feedback === "reloaded"
          ? "rsvp-notice rsvp-notice-success"
          : undefined
      }
    >
      {savedNotice ? (
        <>
          <h3>{savedNotice.title}</h3>
          <p>{savedNotice.message}</p>
        </>
      ) : pending ? (
        operation === "reload" ? (
          "Loading the latest RSVP…"
        ) : (
          "Saving your response…"
        )
      ) : feedback === "reloaded" ? (
        "The latest RSVP has been loaded. Please review it before responding."
      ) : null}
    </div>
  );

  if (!loaded) {
    return (
      <div className="public-rsvp-form" aria-busy={pending}>
        {errorNotice}
        {statusNotice}
      </div>
    );
  }

  return (
    <form
      className="public-rsvp-form"
      aria-label="Your RSVP"
      aria-describedby={notice ? `${id}-error` : undefined}
      aria-busy={pending}
      onSubmit={submit}
      noValidate
    >
      {errorNotice}
      {statusNotice}
      <fieldset disabled={pending || terminal} className="rsvp-fields">
        <legend className="visually-hidden">Your RSVP</legend>
        <fieldset
          className="rsvp-group"
          ref={attendanceRef}
          tabIndex={-1}
          aria-describedby={notice ? `${id}-error` : undefined}
        >
          <legend>Will you join us?</legend>
          {(
            [
              ["ACCEPTED", "Joyfully Accept"],
              ["DECLINED", "Regretfully Decline"],
            ] as const
          ).map(([status, label]) => (
            <label className="rsvp-choice" key={status}>
              <input
                type="radio"
                name={`${id}-attendance`}
                checked={draft.status === status}
                onChange={() => edit({ ...draft, status })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {draft.status === "ACCEPTED" ? (
          <>
            <fieldset
              className="rsvp-group"
              ref={attendeesRef}
              tabIndex={-1}
              aria-describedby={`${id}-total${notice?.section === "attendees" ? ` ${id}-error` : ""}`}
            >
              <legend>Who will be joining us?</legend>
              {invitation.invitees.map((invitee) => (
                <label className="rsvp-choice" key={invitee.id}>
                  <input
                    type="checkbox"
                    checked={draft.namedInviteeIds.includes(invitee.id)}
                    onChange={(event) =>
                      edit(
                        {
                          ...draft,
                          namedInviteeIds: event.target.checked
                            ? [...draft.namedInviteeIds, invitee.id]
                            : draft.namedInviteeIds.filter(
                                (value) => value !== invitee.id,
                              ),
                        },
                        true,
                      )
                    }
                  />
                  <span>{invitee.fullName}</span>
                </label>
              ))}
              {invitation.rules.allowPlusOne ? (
                <label className="rsvp-choice">
                  <input
                    type="checkbox"
                    checked={draft.plusOne}
                    onChange={(event) =>
                      edit({ ...draft, plusOne: event.target.checked }, true)
                    }
                  />
                  <span>Bring a plus one</span>
                </label>
              ) : null}
              {invitation.rules.maxAdditionalChildren > 0 ? (
                <label className="rsvp-count">
                  <span>
                    Additional children{" "}
                    <small>
                      Up to {invitation.rules.maxAdditionalChildren}
                    </small>
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={invitation.rules.maxAdditionalChildren}
                    step={1}
                    value={
                      Number.isNaN(draft.additionalChildren)
                        ? ""
                        : draft.additionalChildren
                    }
                    onChange={(event) =>
                      edit(
                        {
                          ...draft,
                          additionalChildren: event.target.valueAsNumber,
                        },
                        true,
                      )
                    }
                  />
                </label>
              ) : null}
              <p id={`${id}-total`} aria-live="polite">
                Total attending: {Number.isFinite(total) ? total : "—"}
              </p>
            </fieldset>
            <fieldset
              className="rsvp-group"
              ref={eventsRef}
              tabIndex={-1}
              aria-describedby={`${id}-events-help${notice?.section === "events" ? ` ${id}-error` : ""}`}
            >
              <legend>Which events will you attend?</legend>
              <p id={`${id}-events-help`}>
                Choose at least one event, then tell us how many of your guests
                will attend each.
              </p>
              {invitation.events.map((event, index) => {
                const selection = draft.eventSelections[index];
                if (!selection) return null;
                return (
                  <div className="rsvp-event" key={event.id}>
                    <label className="rsvp-choice">
                      <input
                        type="checkbox"
                        checked={selection.attending}
                        onChange={(change) =>
                          edit(
                            normalizeEventCounts({
                              ...draft,
                              eventSelections: draft.eventSelections.map(
                                (item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        attending: change.target.checked,
                                      }
                                    : item,
                              ),
                            }),
                          )
                        }
                      />
                      <span>{event.name}</span>
                    </label>
                    {selection.attending ? (
                      <label className="rsvp-count">
                        <span>
                          Guests attending{" "}
                          <span className="visually-hidden">{event.name}</span>
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={Number.isFinite(total) ? total : 0}
                          step={1}
                          disabled={!Number.isFinite(total) || total < 1}
                          value={
                            Number.isNaN(selection.expectedAttendeeCount)
                              ? ""
                              : selection.expectedAttendeeCount
                          }
                          onChange={(change) =>
                            edit({
                              ...draft,
                              eventSelections: draft.eventSelections.map(
                                (item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        expectedAttendeeCount:
                                          change.target.valueAsNumber,
                                      }
                                    : item,
                              ),
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            <div className="rsvp-dietary">
              <label htmlFor={`${id}-dietary`}>
                Dietary requirements <span>(optional)</span>
              </label>
              <textarea
                id={`${id}-dietary`}
                rows={4}
                maxLength={500}
                value={draft.dietaryNotes}
                aria-describedby={`${id}-dietary-limit`}
                onChange={(event) =>
                  edit({ ...draft, dietaryNotes: event.target.value })
                }
              />
              <p id={`${id}-dietary-limit`}>
                {draft.dietaryNotes.length} / 500 characters
              </p>
            </div>
          </>
        ) : null}
        <button className="rsvp-submit" type="submit" disabled={submitBlocked}>
          {operation === "submit"
            ? "Saving…"
            : notice?.recovery === "retry"
              ? "Try again"
              : "Send RSVP"}
        </button>
      </fieldset>
    </form>
  );
}
