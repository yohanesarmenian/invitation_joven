"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import * as api from "../src/checkin/client";
import {
  qrPattern,
  type Candidate,
  type Events,
} from "../src/checkin/contract";
import { CheckinCamera } from "./checkin-camera";

type Selection = { candidate: Candidate; qrPayload?: string };
type State =
  | { phase: "READY" }
  | { phase: "VALIDATING" }
  | { phase: "VALID_PREVIEW"; selection: Selection }
  | { phase: "CONFIRMING"; selection: Selection }
  | {
      phase: "CONFIRMATION_UNCERTAIN";
      selection: Selection;
      notConfirmed?: boolean;
    }
  | {
      phase: "CONFIRMED" | "ALREADY_CONFIRMED";
      count: number;
      checkedInAt: string;
    }
  | { phase: "ERROR"; code: string };
const messages: Record<string, string> = {
  QR_INVALID:
    "This QR is invalid or no longer available. Check the code or search the household.",
  QR_REVOKED: "This QR has been revoked. Ask the guest for their current pass.",
  EVENT_NOT_ALLOWED: "This household cannot attend the selected event.",
  EVENT_NOT_SELECTED: "This event was not selected in the household RSVP.",
  INVALID_ATTENDEE_COUNT:
    "Enter a whole number from 1 to the expected household count.",
  NETWORK_ERROR:
    "Unable to read the server. Check your connection and try again explicitly.",
  CSRF_INVALID:
    "Session verification failed. The action was not replayed. Try again explicitly.",
  FORBIDDEN: "You do not have permission to use this operation.",
  NOT_FOUND: "The household or event is no longer available.",
};
const displayTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function CheckinWorkspace({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [csrf, setCsrf] = useState(csrfToken);
  const [events, setEvents] = useState<Events["events"]>([]);
  const [eventId, setEventId] = useState("");
  const [qr, setQr] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [count, setCount] = useState("1");
  const [state, setState] = useState<State>({ phase: "READY" });
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const mutationPending = useRef(false);
  const recoveryPending = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const [recovering, setRecovering] = useState(false);
  const locked =
    state.phase === "CONFIRMING" || state.phase === "CONFIRMATION_UNCERTAIN";
  useEffect(() => {
    let live = true;
    void api.loadEvents().then((result) => {
      if (!live) return;
      setEventLoading(false);
      if (result.kind === "ok") {
        setEvents(result.data.events);
        setEventId(
          result.data.events.length === 1 ? result.data.events[0]!.id : "",
        );
        setEventError(false);
      } else if (result.kind === "error" && result.code === "UNAUTHENTICATED")
        router.replace(SESSION_ENDED_PATH);
      else setEventError(true);
    });
    return () => {
      live = false;
      invalidate();
    };
  }, [router, reload, invalidate]);

  useEffect(() => {
    if (
      [
        "VALID_PREVIEW",
        "CONFIRMATION_UNCERTAIN",
        "CONFIRMED",
        "ALREADY_CONFIRMED",
        "ERROR",
      ].includes(state.phase)
    ) {
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [state.phase]);

  function failure(result: api.Failure) {
    if (result.kind === "error") {
      if (result.csrfToken) setCsrf(result.csrfToken);
      if (result.code === "UNAUTHENTICATED") {
        setQr("");
        setItems(null);
        setState({ phase: "READY" });
        router.replace(SESSION_ENDED_PATH);
        return;
      }
      setState({ phase: "ERROR", code: result.code });
    }
  }
  function reset() {
    generation.current++;
    setState({ phase: "READY" });
    setItems(null);
  }
  async function validate(payload = qr) {
    if (locked || !eventId || !qrPattern.test(payload)) return;
    const ticket = ++generation.current;
    setItems(null);
    setState({ phase: "VALIDATING" });
    const result = await api.validateQr(payload, eventId, csrf);
    if (ticket !== generation.current) return;
    if (result.kind !== "ok") {
      failure(result);
      return;
    }
    if (result.data.event.id !== eventId) {
      setState({ phase: "ERROR", code: "NETWORK_ERROR" });
      return;
    }
    if (result.data.previousCheckin) {
      setQr("");
      setState({
        phase: "ALREADY_CONFIRMED",
        count: result.data.previousCheckin.attendeeCount,
        checkedInAt: result.data.previousCheckin.checkedInAt,
      });
      return;
    }
    setCount(String(result.data.expectedAttendeeCount));
    setState({
      phase: "VALID_PREVIEW",
      selection: { candidate: result.data, qrPayload: payload },
    });
  }
  async function search() {
    if (locked || !eventId || [...query.trim()].length < 2) return;
    const ticket = ++generation.current;
    setQr("");
    setState({ phase: "VALIDATING" });
    setItems(null);
    const result = await api.searchHouseholds(query.trim(), eventId);
    if (ticket !== generation.current) return;
    if (result.kind !== "ok") {
      failure(result);
      return;
    }
    if (result.data.items.some((item) => item.event.id !== eventId)) {
      setState({ phase: "ERROR", code: "NETWORK_ERROR" });
      return;
    }
    setItems(result.data.items);
    setState({ phase: "READY" });
  }
  function select(candidate: Candidate) {
    generation.current++;
    setQr("");
    setItems(null);
    setCount(String(candidate.expectedAttendeeCount));
    const selection = { candidate };
    setState(
      candidate.alreadyCheckedIn
        ? { phase: "CONFIRMATION_UNCERTAIN", selection }
        : { phase: "VALID_PREVIEW", selection },
    );
  }
  async function confirm() {
    if (state.phase !== "VALID_PREVIEW" || mutationPending.current) return;
    const attendeeCount = Number(count),
      selection = state.selection;
    if (
      !Number.isSafeInteger(attendeeCount) ||
      attendeeCount < 1 ||
      attendeeCount > selection.candidate.expectedAttendeeCount
    ) {
      setState({ phase: "ERROR", code: "INVALID_ATTENDEE_COUNT" });
      return;
    }
    mutationPending.current = true;
    generation.current++;
    setState({ phase: "CONFIRMING", selection });
    const { candidate, qrPayload } = selection;
    const result = qrPayload
      ? await api.confirmQr(qrPayload, candidate.event.id, attendeeCount, csrf)
      : await api.confirmManual(
          candidate.invitation.id,
          candidate.event.id,
          attendeeCount,
          csrf,
        );
    mutationPending.current = false;
    if (result.kind === "ok") {
      setQr("");
      setQuery("");
      setState({
        phase: "CONFIRMED",
        count: result.data.checkinRecord.attendeeCount,
        checkedInAt: result.data.checkinRecord.checkedInAt,
      });
    } else if (
      result.kind === "uncertain" ||
      (result.kind === "error" && result.code === "CHECKIN_ALREADY_CONFIRMED")
    )
      setState({ phase: "CONFIRMATION_UNCERTAIN", selection });
    else failure(result);
  }
  async function recover() {
    if (state.phase !== "CONFIRMATION_UNCERTAIN" || recoveryPending.current)
      return;
    recoveryPending.current = true;
    setRecovering(true);
    const selection = state.selection,
      { candidate, qrPayload } = selection;
    const result = qrPayload
      ? await api.validateQr(qrPayload, candidate.event.id, csrf)
      : await api.readManualStatus(
          candidate.invitation.id,
          candidate.event.id,
          csrf,
        );
    recoveryPending.current = false;
    setRecovering(false);
    if (result.kind === "ok") {
      if (result.data.previousCheckin) {
        setQr("");
        setState({
          phase: "ALREADY_CONFIRMED",
          count: result.data.previousCheckin.attendeeCount,
          checkedInAt: result.data.previousCheckin.checkedInAt,
        });
      } else
        setState({
          phase: "CONFIRMATION_UNCERTAIN",
          selection,
          notConfirmed: true,
        });
    } else if (result.kind === "error") {
      if (result.csrfToken) setCsrf(result.csrfToken);
      if (result.code === "UNAUTHENTICATED") failure(result);
      // Keep the exact recovery target on network, permission, and revoked-QR failures.
      else setState({ phase: "CONFIRMATION_UNCERTAIN", selection });
    }
  }
  return (
    <div className="checkin-workspace">
      <section
        className="import-panel checkin-event-context"
        aria-label="Event context"
      >
        <p className="create-step">01 / Wedding event</p>
        <label htmlFor="checkin-event">Event</label>
        <select
          id="checkin-event"
          value={eventId}
          disabled={locked || eventLoading}
          onChange={(e) => {
            reset();
            setQr("");
            setQuery("");
            setEventId(e.target.value);
          }}
        >
          <option value="">Select an event</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {eventLoading && <p role="status">Loading events…</p>}
        {eventError && (
          <p role="alert">
            Unable to load events.{" "}
            <button
              onClick={() => {
                setEventLoading(true);
                setReload((n) => n + 1);
              }}
            >
              Reload events
            </button>
          </p>
        )}
        {!eventLoading && !eventError && events.length === 0 && (
          <p>No active events are available.</p>
        )}
        {!eventLoading && !eventError && events.length === 1 && (
          <p className="hint">
            Your only eligible event is selected automatically.
          </p>
        )}
        <p>
          Validate a QR or find a household, review the guests, then confirm.
          Validation does not record attendance.
        </p>
        <p className="checkin-policy">
          One confirmation per household and event. Partial arrivals and
          corrections are not supported. Gather the household before confirming
          its arriving count.
        </p>
      </section>
      <div className="checkin-inputs">
        <section className="import-panel">
          <p className="create-step">02 / Scan a pass</p>
          <h2>QR check-in</h2>
          {!locked && state.phase !== "VALIDATING" && (
            <CheckinCamera
              key={eventId}
              disabled={!eventId}
              onStart={() => {
                reset();
                setQr("");
              }}
              onDecode={(payload) => {
                setQr(payload);
                void validate(payload);
              }}
            />
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void validate();
            }}
          >
            <label htmlFor="manual-qr">QR code</label>
            <input
              id="manual-qr"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={qr}
              disabled={locked || !eventId}
              onChange={(e) => {
                reset();
                setQr(e.target.value);
              }}
            />
            <button
              disabled={
                locked ||
                state.phase === "VALIDATING" ||
                !eventId ||
                !qrPattern.test(qr)
              }
            >
              Validate QR
            </button>
          </form>
        </section>
        <section className="import-panel">
          <p className="create-step">Or / Search by name</p>
          <h2>Find a household</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <label htmlFor="household-query">Household name</label>
            <input
              id="household-query"
              autoComplete="off"
              value={query}
              disabled={locked || !eventId}
              onChange={(e) => {
                reset();
                setQuery(e.target.value);
              }}
            />
            <button
              disabled={
                locked ||
                state.phase === "VALIDATING" ||
                !eventId ||
                [...query.trim()].length < 2
              }
            >
              Search households
            </button>
          </form>
          {items && (
            <>
              <p role="status">
                {items.length
                  ? "Up to 10 matching households. Refine the name if needed."
                  : "No matching households for this event."}
              </p>
              <ul>
                {items.map((item) => (
                  <li key={item.invitation.id}>
                    <button onClick={() => select(item)}>
                      {item.invitation.displayName} · expected{" "}
                      {item.expectedAttendeeCount}
                      {item.alreadyCheckedIn ? " · already confirmed" : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      <section
        className="import-panel checkin-result"
        aria-label="Check-in result"
        ref={resultRef}
        tabIndex={-1}
      >
        <p className="create-step">03 / Review and confirm</p>
        <p role="status">
          {state.phase === "READY"
            ? "Ready"
            : state.phase === "VALIDATING"
              ? "Reading server…"
              : state.phase === "CONFIRMING"
                ? "Confirming attendance…"
                : ""}
        </p>
        {state.phase === "READY" && !items && (
          <p className="hint">
            A validated household and its expected attendance will appear here
            before you confirm.
          </p>
        )}
        {state.phase === "ERROR" && (
          <p role="alert">
            {messages[state.code] ??
              "The action was rejected. Read the household again before confirming."}
          </p>
        )}
        {(state.phase === "VALID_PREVIEW" || state.phase === "CONFIRMING") && (
          <>
            <h2>{state.selection.candidate.invitation.displayName}</h2>
            <p>
              {state.selection.candidate.event.name} · expected{" "}
              {state.selection.candidate.expectedAttendeeCount}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void confirm();
              }}
            >
              <label htmlFor="actual-count">People arriving now</label>
              <input
                id="actual-count"
                inputMode="numeric"
                type="number"
                min={1}
                max={state.selection.candidate.expectedAttendeeCount}
                step={1}
                value={count}
                disabled={state.phase === "CONFIRMING"}
                onChange={(e) => setCount(e.target.value)}
                required
                aria-describedby="checkin-count-help"
              />
              <button disabled={state.phase === "CONFIRMING"}>
                Confirm check-in
              </button>
            </form>
            <p id="checkin-count-help">
              Confirmation records this household once for this event. Partial
              arrivals and corrections are not supported.
            </p>
          </>
        )}
        {state.phase === "CONFIRMATION_UNCERTAIN" && (
          <>
            <h2>Check the server before continuing</h2>
            <p>
              {state.selection.candidate.invitation.displayName} ·{" "}
              {state.selection.candidate.event.name}
            </p>
            <p role="alert">
              The confirmation outcome is unknown or was already recorded. No
              confirmation will be retried automatically.
            </p>
            {state.notConfirmed && (
              <p>
                No confirmation was visible at the last read. An earlier request
                might still finish. Recheck before starting an explicit new
                attempt.
              </p>
            )}
            <button disabled={recovering} onClick={() => void recover()}>
              {recovering
                ? "Reading status…"
                : "Recheck exact household and event"}
            </button>
            {state.notConfirmed && (
              <button
                disabled={recovering}
                onClick={() => {
                  setCount(
                    String(state.selection.candidate.expectedAttendeeCount),
                  );
                  setState({
                    phase: "VALID_PREVIEW",
                    selection: state.selection,
                  });
                }}
              >
                Start a new explicit attempt
              </button>
            )}
            <p>
              If recovery cannot be read, restore the connection or ask the
              OWNER. Do not blindly repeat the confirmation.
            </p>
          </>
        )}
        {(state.phase === "CONFIRMED" ||
          state.phase === "ALREADY_CONFIRMED") && (
          <>
            <h2>
              {state.phase === "CONFIRMED"
                ? "Check-in confirmed"
                : "Already confirmed"}
            </h2>
            <p>
              {state.count} people · {displayTime(state.checkedInAt)} (Jakarta)
            </p>
            <button
              onClick={() => {
                reset();
                setQr("");
                setQuery("");
              }}
            >
              Next household
            </button>
          </>
        )}
      </section>
    </div>
  );
}
