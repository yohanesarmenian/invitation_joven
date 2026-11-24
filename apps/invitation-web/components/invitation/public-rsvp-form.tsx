"use client";

import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  PublicRsvpMutationResponse,
  PublicRsvpReadResponse,
  SubmitPublicRsvpRequest,
} from "../../../../packages/api-client/src/index";
import type { RsvpFailure, RsvpResult } from "../../src/rsvp/result";
import type { EditRsvpDietary } from "../../src/server/public-rsvp";
import {
  rsvpFailureNotice,
  rsvpLoadFailureNotice,
  rsvpSuccessNotice,
  type RsvpNotice,
} from "../../src/rsvp/notice";
import { RsvpResultNotice } from "./rsvp-result-notice";
import { GuestCheckinPass } from "./guest-checkin-pass";
import {
  RsvpHeroActionUpdate,
  RSVP_RESPONSE_HEADING_ID,
  type RsvpHeroAction,
} from "./invitation-opening-context";
import {
  attendeeTotal,
  attendeeOptions,
  changePartyMode,
  createRsvpDraft,
  partyIssue,
  restoreSavedDraft,
  sameAttendance,
  selectedSession,
  sessionOptions,
  toRsvpRequest,
  validateRsvpDraft,
  type PartyMode,
  type RsvpDraft,
  type RsvpInvitation,
} from "./public-rsvp-state";

export type PublicRsvpFormProps = {
  invitation: RsvpInvitation;
  initialResult: RsvpResult<PublicRsvpReadResponse>;
  submitAction: (
    request: SubmitPublicRsvpRequest | EditRsvpDietary,
  ) => Promise<RsvpResult<PublicRsvpMutationResponse>>;
  reloadAction: () => Promise<RsvpResult<PublicRsvpReadResponse>>;
};

function isDeadlineRejection(error: RsvpFailure) {
  return (
    error.kind === "api" &&
    error.httpStatus === 422 &&
    error.code === "RSVP_DEADLINE_PASSED"
  );
}

export function PublicRsvpForm({
  invitation,
  initialResult,
  submitAction,
  reloadAction,
}: PublicRsvpFormProps) {
  const id = useId();
  const [canonicalResponse, setCanonical] = useState(
    initialResult.status === "success" ? initialResult.data : null,
  );
  const canonical = canonicalResponse?.rsvp ?? null;
  const responded =
    canonical?.status === "ACCEPTED" || canonical?.status === "DECLINED";
  const [editing, setEditing] = useState(false);
  const [preserveAttendance, setPreserveAttendance] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // Keep a stale pass suspended even if a later failed reload changes the notice.
  const [passNeedsReload, setPassNeedsReload] = useState(false);
  const [draft, setDraft] = useState(() => createRsvpDraft(canonical));
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
    "conflict" | "closed" | "unavailable" | "uncertain" | null
  >(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const attendanceRef = useRef<HTMLFieldSetElement>(null);
  const attendeesRef = useRef<HTMLFieldSetElement>(null);
  const eventsRef = useRef<HTMLFieldSetElement>(null);
  const total = attendeeTotal(draft);
  const sessions = sessionOptions(invitation.events);
  const session = selectedSession(draft, invitation);
  const accepted = draft.status === "ACCEPTED";
  const sessionReady = accepted && session !== undefined;
  const partyReady = sessionReady && !partyIssue(draft, invitation);
  const savedDraft = canonical && restoreSavedDraft(invitation, canonical);
  const pending = operation !== null;
  const terminal =
    lock === "closed" ||
    lock === "unavailable" ||
    canonicalResponse?.canEdit === false;
  const viewingSavedResponse = loaded && !editing && !pending;
  const confirmedView = viewingSavedResponse && !failure && !lock;
  const deadlineRejected =
    lock === "closed" &&
    failure?.source === "submit" &&
    isDeadlineRejection(failure.error);
  const pass = canonicalResponse?.checkinPass;
  const activePass =
    viewingSavedResponse &&
    (confirmedView || deadlineRejected) &&
    canonical?.status === "ACCEPTED" &&
    !passNeedsReload &&
    pass?.status === "ACTIVE"
      ? pass
      : null;
  const updateHeroAction = useContext(RsvpHeroActionUpdate);
  let heroAction: RsvpHeroAction = "rsvp";
  if (activePass) heroAction = "qr";
  else if (confirmedView && canonical?.status === "DECLINED")
    heroAction = "response";
  else if (confirmedView && !responded && !terminal) heroAction = "confirm";
  useLayoutEffect(() => {
    updateHeroAction?.(heroAction);
  }, [heroAction, updateHeroAction]);
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
    pending ||
    terminal ||
    !loaded ||
    lock !== null ||
    notice?.recovery === "correct";
  const savedNotice =
    feedback === "saved" &&
    (canonical?.status === "ACCEPTED" || canonical?.status === "DECLINED")
      ? rsvpSuccessNotice(canonical.status)
      : null;

  useEffect(() => {
    if (failure || validation) errorRef.current?.focus();
    else if (feedback === "reloaded" || feedback === "saved")
      statusRef.current?.focus();
  }, [failure, validation, feedback]);

  function edit(next: RsvpDraft) {
    if (inFlight.current || terminal) return;
    setDraft(next);
    setValidation(null);
    if (lock === null) setFailure(null);
    setFeedback(null);
  }

  function recordFailure(error: RsvpFailure, source: "submit" | "reload") {
    setFailure({ error, source });
    if (source === "submit" && rsvpFailureNotice(error).recovery === "reload") {
      setPassNeedsReload(true);
      setLock("uncertain");
    }
    if (error.kind !== "api") return;
    if (
      (error.httpStatus === 409 &&
        (error.code === "RSVP_VERSION_CONFLICT" ||
          error.code === "RSVP_LOCKED_AFTER_CHECKIN")) ||
      (error.httpStatus === 404 && error.code === "INVITATION_NOT_AVAILABLE")
    )
      setPassNeedsReload(true);
    if (error.httpStatus === 409 && error.code === "RSVP_VERSION_CONFLICT")
      setLock("conflict");
    if (
      isDeadlineRejection(error) ||
      (error.httpStatus === 409 && error.code === "RSVP_LOCKED_AFTER_CHECKIN")
    )
      setLock("closed");
    if (error.httpStatus === 404 && error.code === "INVITATION_NOT_AVAILABLE")
      setLock("unavailable");
  }

  async function reload(forEditing = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setOperation("reload");
    setFeedback(null);
    setValidation(null);
    try {
      const result = await reloadAction();
      if (result.status === "error") recordFailure(result.error, "reload");
      else {
        setCanonical(result.data);
        setEditing(forEditing && result.data.canEdit);
        const saved = result.data.rsvp;
        const restored = saved && restoreSavedDraft(invitation, saved);
        setPreserveAttendance(
          Boolean(forEditing && saved?.status === "ACCEPTED" && !restored),
        );
        setReplacing(false);
        setPassNeedsReload(false);
        setDraft(restored ?? createRsvpDraft(saved));
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
    const dietaryOnly =
      canonical?.status === "ACCEPTED" &&
      (preserveAttendance || sameAttendance(draft, savedDraft));
    const invalid = dietaryOnly
      ? draft.dietaryNotes.trim().length > 500
        ? "Please limit dietary notes to 500 characters."
        : null
      : validateRsvpDraft(draft, invitation);
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
        dietaryOnly
          ? {
              expectedVersion: canonical.version,
              dietaryNotes: draft.dietaryNotes.trim() || null,
            }
          : toRsvpRequest(draft, canonical?.version ?? null),
      );
      if (result.status === "error") {
        recordFailure(result.error, "submit");
        if (
          isDeadlineRejection(result.error) &&
          canonical?.status === "ACCEPTED" &&
          pass?.status === "ACTIVE"
        ) {
          // Deadline rejection can precede the version check. Refresh the pass
          // without reopening editing or discarding the rejected draft.
          setPassNeedsReload(true);
          const latest = await reloadAction().catch(() => null);
          if (latest?.status === "success") {
            setCanonical(latest.data);
            setPassNeedsReload(false);
          }
        }
      } else {
        setCanonical((current) =>
          current ? { ...current, ...result.data } : null,
        );
        setEditing(false);
        setPreserveAttendance(false);
        setReplacing(false);
        setDraft(createRsvpDraft(result.data.rsvp));
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
      onReload={() => void reload()}
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

  const restriction =
    canonicalResponse?.editBlockedReason === "CHECKED_IN"
      ? "Your household has checked in. RSVP changes are now closed. Reception staff can assist you."
      : canonicalResponse?.editBlockedReason === "DEADLINE_PASSED"
        ? responded
          ? "The RSVP edit window has closed. Your saved response remains available."
          : "The reply deadline has passed. Contact the couple if you need help."
        : null;

  if (responded && !editing) {
    return (
      <section
        className="public-rsvp-form rsvp-confirmation"
        aria-label="Your RSVP confirmation"
        aria-busy={pending}
      >
        {errorNotice}
        {statusNotice}
        <h3
          id={RSVP_RESPONSE_HEADING_ID}
          tabIndex={-1}
          className="invitation-rsvp-jump-target"
        >
          {canonical.status === "ACCEPTED"
            ? "Attendance Confirmed"
            : "Unable to Attend"}
        </h3>
        {canonical.status === "ACCEPTED" ? (
          <>
            <SavedAttendance invitation={invitation} rsvp={canonical} />
            <GuestCheckinPass pass={activePass} />
          </>
        ) : (
          <p>Your response has been saved as not attending.</p>
        )}
        {restriction ? <p role="status">{restriction}</p> : null}
        {canonicalResponse?.canEdit && lock === null ? (
          <button
            type="button"
            className="rsvp-submit"
            disabled={pending}
            onClick={() => void reload(true)}
          >
            Edit RSVP
          </button>
        ) : null}
      </section>
    );
  }

  const namedOptions = attendeeOptions(invitation, draft.partyMode);
  const namedChildren = invitation.invitees.filter(
    ({ category }) => category === "CHILD",
  );
  const childrenAllowed =
    namedChildren.length > 0 || invitation.rules.maxAdditionalChildren > 0;
  const hasAdult = invitation.invitees.some(
    ({ category }) => category === "ADULT",
  );
  const partyChoices: [PartyMode, string][] = [
    ["ALONE", "I’ll attend on my own"],
  ];
  if (hasAdult) partyChoices.push(["FAMILY", "I’ll attend with family"]);
  if (hasAdult && invitation.rules.allowPlusOne)
    partyChoices.push(["PLUS_ONE", "I’ll bring a plus one"]);

  const dietaryField = (
    <div className="rsvp-dietary">
      <label htmlFor={`${id}-dietary`}>
        Dietary Restrictions &amp; Preferences <span>(optional)</span>
      </label>
      <textarea
        id={`${id}-dietary`}
        aria-label="Dietary requirements (optional)"
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
  );
  const submitButton = (
    <button className="rsvp-submit" type="submit" disabled={submitBlocked}>
      {operation === "submit"
        ? "Saving…"
        : notice?.recovery === "retry"
          ? "Try again"
          : editing
            ? "Save Changes"
            : "Submit RSVP"}
    </button>
  );

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
      {restriction ? <p role="status">{restriction}</p> : null}
      {!responded ? (
        <p>
          Please confirm your attendance to receive your personal check-in QR
          code.
        </p>
      ) : null}
      <p>If your QR code cannot be read, reception staff can assist you.</p>
      {preserveAttendance && canonical ? (
        <>
          <SavedAttendance invitation={invitation} rsvp={canonical} />
          <p>
            Your saved attendance differs from the new form. You can update
            dietary notes and keep all attendance details.
          </p>
          <fieldset disabled={pending || terminal} className="rsvp-fields">
            <legend className="visually-hidden">
              Edit dietary information
            </legend>
            {dietaryField}
            <button
              type="button"
              className="rsvp-submit rsvp-cancel"
              onClick={() => {
                edit(createRsvpDraft(canonical));
                setPreserveAttendance(false);
                setReplacing(true);
                requestAnimationFrame(() => attendanceRef.current?.focus());
              }}
            >
              Change attendance details
            </button>
            {submitButton}
          </fieldset>
        </>
      ) : (
        <fieldset disabled={pending || terminal} className="rsvp-fields">
          <legend className="visually-hidden">Your RSVP</legend>
          {replacing && (
            <p role="note">
              Review the replacement before saving. The same party will attend
              every selected session.
            </p>
          )}
          <fieldset
            className="rsvp-group"
            ref={attendanceRef}
            tabIndex={-1}
            aria-label="Will you join us?"
          >
            <legend>Attendance Confirmation</legend>
            <div className="rsvp-attendance-options">
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
                    onChange={() =>
                      edit(
                        status === "DECLINED"
                          ? { ...createRsvpDraft(null), status }
                          : {
                              ...draft,
                              status,
                              sessionIds:
                                sessions.length === 1
                                  ? sessions[0]!.ids
                                  : draft.sessionIds,
                            },
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {accepted && (
            <fieldset
              className="rsvp-group"
              ref={eventsRef}
              tabIndex={-1}
              aria-describedby={
                notice?.section === "events" ? `${id}-error` : undefined
              }
            >
              <legend>Which sessions will you attend?</legend>
              {sessions.length === 0 ? (
                <p role="status">
                  The wedding sessions for this invitation need to be checked.
                  Contact the couple for help.
                </p>
              ) : sessions.length === 1 ? (
                <p>
                  <strong>{sessions[0]!.label}</strong> is selected for this
                  invitation.
                </p>
              ) : (
                sessions.map((option) => (
                  <label key={option.ids.join(",")} className="rsvp-choice">
                    <input
                      type="radio"
                      name={`${id}-sessions`}
                      checked={session?.ids.join(",") === option.ids.join(",")}
                      onChange={() =>
                        edit({ ...draft, sessionIds: option.ids })
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))
              )}
            </fieldset>
          )}
          {sessionReady && (
            <fieldset
              className="rsvp-group"
              ref={attendeesRef}
              tabIndex={-1}
              aria-describedby={
                notice?.section === "attendees" ? `${id}-error` : undefined
              }
            >
              <legend>Who will attend with you?</legend>
              {partyChoices.map(([mode, label]) => (
                <label className="rsvp-choice" key={mode}>
                  <input
                    type="radio"
                    name={`${id}-party`}
                    checked={draft.partyMode === mode}
                    onChange={() =>
                      edit(changePartyMode(draft, invitation, mode))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
              {draft.partyMode && (
                <fieldset className="rsvp-group">
                  <legend>
                    {draft.partyMode === "FAMILY"
                      ? "Invited adults attending"
                      : "Select the invited attendee"}
                  </legend>
                  {namedOptions.length === 1 ? (
                    <p>{namedOptions[0]!.fullName}</p>
                  ) : (
                    namedOptions.map(({ id: inviteeId, fullName }) => (
                      <label className="rsvp-choice" key={inviteeId}>
                        <input
                          type={
                            draft.partyMode === "FAMILY" ? "checkbox" : "radio"
                          }
                          name={`${id}-named`}
                          checked={draft.namedInviteeIds.includes(inviteeId)}
                          onChange={(event) =>
                            edit({
                              ...draft,
                              namedInviteeIds:
                                draft.partyMode === "FAMILY"
                                  ? toggleId(
                                      draft.namedInviteeIds,
                                      inviteeId,
                                      event.target.checked,
                                    )
                                  : [inviteeId],
                            })
                          }
                        />
                        <span>{fullName}</span>
                      </label>
                    ))
                  )}
                </fieldset>
              )}
              {draft.partyMode === "PLUS_ONE" && (
                <p>One additional companion is included.</p>
              )}
              {draft.partyMode === "FAMILY" && (
                <>
                  {invitation.rules.allowPlusOne && (
                    <label className="rsvp-choice">
                      <input
                        type="checkbox"
                        checked={draft.plusOne}
                        onChange={(event) =>
                          edit({ ...draft, plusOne: event.target.checked })
                        }
                      />
                      <span>Include one additional partner</span>
                    </label>
                  )}
                  {childrenAllowed && (
                    <div className="rsvp-companion">
                      <label className="rsvp-choice">
                        <input
                          type="checkbox"
                          checked={draft.includeChildren}
                          onChange={(event) =>
                            edit(
                              event.target.checked
                                ? { ...draft, includeChildren: true }
                                : {
                                    ...draft,
                                    includeChildren: false,
                                    additionalChildren: 0,
                                    namedInviteeIds:
                                      draft.namedInviteeIds.filter(
                                        (selected) =>
                                          !namedChildren.some(
                                            ({ id }) => id === selected,
                                          ),
                                      ),
                                  },
                            )
                          }
                        />
                        <span>Include children</span>
                      </label>
                      {draft.includeChildren && (
                        <>
                          {namedChildren.map(({ id: inviteeId, fullName }) => (
                            <label key={inviteeId} className="rsvp-choice">
                              <input
                                type="checkbox"
                                checked={draft.namedInviteeIds.includes(
                                  inviteeId,
                                )}
                                onChange={(event) =>
                                  edit({
                                    ...draft,
                                    namedInviteeIds: toggleId(
                                      draft.namedInviteeIds,
                                      inviteeId,
                                      event.target.checked,
                                    ),
                                  })
                                }
                              />
                              <span>{fullName}</span>
                            </label>
                          ))}
                          {invitation.rules.maxAdditionalChildren > 0 && (
                            <label className="rsvp-count">
                              <span>
                                Additional children (excluding named children
                                above)
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={invitation.rules.maxAdditionalChildren}
                                step={1}
                                value={
                                  Number.isNaN(draft.additionalChildren)
                                    ? ""
                                    : draft.additionalChildren
                                }
                                onChange={(event) =>
                                  edit({
                                    ...draft,
                                    additionalChildren:
                                      event.target.valueAsNumber,
                                  })
                                }
                              />
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </fieldset>
          )}
          {partyReady && (
            <>
              <div
                className="rsvp-group"
                role="region"
                aria-label="Review attendance"
              >
                <h3>Review your attendance</h3>
                <p>{session.label}</p>
                <p>
                  Attending named guests:{" "}
                  {invitation.invitees
                    .filter(({ id }) => draft.namedInviteeIds.includes(id))
                    .map(({ fullName }) => fullName)
                    .join(", ")}
                </p>
                <p>
                  Additional companions: {Number(draft.plusOne)} · Additional
                  children: {draft.additionalChildren}
                </p>
                <p>
                  {total} {total === 1 ? "person" : "people"} expected at each
                  selected session.
                </p>
              </div>
              {dietaryField}
            </>
          )}
          {submitButton}
        </fieldset>
      )}
      {editing ? (
        <button
          type="button"
          className="rsvp-submit rsvp-cancel"
          disabled={pending}
          onClick={() => {
            setDraft(createRsvpDraft(canonical));
            setPreserveAttendance(false);
            setReplacing(false);
            setEditing(false);
            setValidation(null);
            setFeedback(null);
          }}
        >
          Cancel
        </button>
      ) : null}
    </form>
  );
}

function toggleId(ids: string[], id: string, checked: boolean) {
  return checked ? [...ids, id] : ids.filter((item) => item !== id);
}

function SavedAttendance({
  invitation,
  rsvp,
}: {
  invitation: RsvpInvitation;
  rsvp: NonNullable<PublicRsvpReadResponse["rsvp"]>;
}) {
  return (
    <>
      <p>Expected guests: {rsvp.attendeeQuantityTotal}</p>
      <ul>
        {rsvp.attendees.map((attendee, index) => (
          <li key={index}>
            {attendee.type === "NAMED_INVITEE"
              ? (invitation.invitees.find(({ id }) => id === attendee.inviteeId)
                  ?.fullName ?? "Named guest")
              : attendee.type === "PLUS_ONE"
                ? "Plus-one"
                : attendee.type === "UNNAMED_COMPANION"
                  ? "Unnamed companions"
                  : "Additional children"}{" "}
            × {attendee.quantity}
          </li>
        ))}
      </ul>
      <ul>
        {rsvp.eventSelections
          .filter(({ attending }) => attending)
          .map(({ eventId, expectedAttendeeCount }) => (
            <li key={eventId}>
              {invitation.events.find(({ id }) => id === eventId)?.name ??
                "Wedding event"}
              : {expectedAttendeeCount} guests
            </li>
          ))}
      </ul>
      {rsvp.dietaryNotes && <p>Dietary requirements: {rsvp.dietaryNotes}</p>}
    </>
  );
}
