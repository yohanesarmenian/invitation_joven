"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type {
  PublicRsvpMutationResponse,
  PublicRsvpReadResponse,
  SubmitPublicRsvpRequest,
} from "../../../../packages/api-client/src/index";
import type { RsvpFailure, RsvpResult } from "../../src/rsvp/result";
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
};

export function PublicRsvpForm({
  invitation,
  initialResult,
  submitAction,
}: PublicRsvpFormProps) {
  const id = useId();
  const [canonical, setCanonical] = useState(
    initialResult.status === "success" ? initialResult.data.rsvp : null,
  );
  const [draft, setDraft] = useState(() =>
    createRsvpDraft(invitation, canonical),
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [failure, setFailure] = useState<RsvpFailure | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const total = attendeeTotal(draft);
  const errorMessage =
    validation ??
    (failure ? "We couldn’t save your response. Please try again." : null);

  useEffect(() => {
    if (errorMessage) errorRef.current?.focus();
  }, [errorMessage]);

  function edit(next: RsvpDraft, compositionChanged = false) {
    setDraft(compositionChanged ? normalizeEventCounts(next) : next);
    setValidation(null);
    setFailure(null);
    setSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || initialResult.status !== "success") return;
    const invalid = validateRsvpDraft(draft, invitation);
    if (invalid) {
      setValidation(invalid);
      return;
    }
    inFlight.current = true;
    setPending(true);
    setSaved(false);
    setValidation(null);
    setFailure(null);
    try {
      const result = await submitAction(
        toRsvpRequest(draft, canonical?.version ?? null),
      );
      if (result.status === "error") {
        setFailure(result.error);
      } else {
        setCanonical(result.data.rsvp);
        setDraft(createRsvpDraft(invitation, result.data.rsvp));
        setSaved(true);
      }
    } catch {
      setFailure({ kind: "network", httpStatus: null, code: null });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (initialResult.status === "error") {
    return (
      <p role="alert">
        We couldn’t load your RSVP. Please reload the invitation to try again.
      </p>
    );
  }

  return (
    <form
      className="public-rsvp-form"
      aria-label="Your RSVP"
      aria-describedby={errorMessage ? `${id}-error` : undefined}
      aria-busy={pending}
      onSubmit={submit}
      noValidate
    >
      <fieldset disabled={pending} className="rsvp-fields">
        <legend className="visually-hidden">Your RSVP</legend>
        <fieldset
          className="rsvp-group"
          aria-describedby={errorMessage ? `${id}-error` : undefined}
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
            <fieldset className="rsvp-group" aria-describedby={`${id}-total`}>
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
              aria-describedby={`${id}-events-help`}
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
        <button className="rsvp-submit" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Send RSVP"}
        </button>
      </fieldset>
      {errorMessage ? (
        <p
          id={`${id}-error`}
          className="rsvp-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {errorMessage}
        </p>
      ) : null}
      <p role="status">
        {saved
          ? "Your response has been saved."
          : pending
            ? "Saving your response…"
            : ""}
      </p>
    </form>
  );
}
