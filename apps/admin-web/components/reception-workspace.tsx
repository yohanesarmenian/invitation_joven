"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CheckinEventsResponse,
  ReceptionArrival,
  ReceptionArrivalRequest,
  ReceptionDetail,
  ReceptionSearch,
  ReceptionStatistics,
} from "@wedding-invitation/api-client/src/index";
import * as api from "../src/reception/client";
import { loadEvents } from "../src/checkin/client";
import { CheckinCamera } from "./checkin-camera";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";

const wib = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "short",
});
function ArrivalConfirmation({
  body,
  name,
  onConfirm,
  onCancel,
}: {
  body: ReceptionArrivalRequest;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="reception-dialog"
      aria-labelledby="reception-confirm-title"
      onCancel={onCancel}
    >
      <h2 id="reception-confirm-title">Confirm reception arrival</h2>
      <p>
        {name}: add {body.attendeeCount} arriving guests.{" "}
        {body.onSite
          ? `Expected attendance will be ${body.onSite.eventSelections[0]?.expectedAttendeeCount}.`
          : "The saved expected attendance stays unchanged."}
      </p>
      <button onClick={onConfirm}>Confirm arrival</button>
      <button onClick={onCancel}>Cancel</button>
    </dialog>
  );
}
export function ReceptionWorkspace({ csrfToken }: { csrfToken: string }) {
  const router = useRouter(),
    lock = useRef(false),
    sequence = useRef(0);
  const [csrf, setCsrf] = useState(csrfToken),
    [events, setEvents] = useState<CheckinEventsResponse["events"]>([]),
    [eventId, setEventId] = useState("");
  const [mode, setMode] = useState<"find" | "scan" | "help">("find"),
    [query, setQuery] = useState(""),
    [qrEntry, setQrEntry] = useState(""),
    [page, setPage] = useState(1),
    [results, setResults] = useState<ReceptionSearch | null>(null),
    [detail, setDetail] = useState<ReceptionDetail | null>(null),
    [statistics, setStatistics] = useState<ReceptionStatistics | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [qr, setQr] = useState<string | null>(null),
    [arriving, setArriving] = useState(1),
    [expected, setExpected] = useState(1),
    [named, setNamed] = useState<string[]>([]),
    [plusOne, setPlusOne] = useState(false),
    [children, setChildren] = useState(0),
    [verification, setVerification] = useState<
      "PHYSICAL_INVITATION" | "HOUSEHOLD_DETAILS"
    >("PHYSICAL_INVITATION"),
    [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<ReceptionArrivalRequest | null>(null),
    [uncertain, setUncertain] = useState<ReceptionArrivalRequest | null>(null),
    [notFoundOperation, setNotFoundOperation] = useState(false),
    [receipt, setReceipt] = useState<ReceptionArrival | null>(null);
  const blocked = busy || uncertain !== null;
  function fail(result: Exclude<api.Result<unknown>, { kind: "ok" }>) {
    if (result.kind === "error") {
      if (result.code === "UNAUTHENTICATED") {
        router.replace(SESSION_ENDED_PATH);
        return;
      }
      if (result.csrfToken) setCsrf(result.csrfToken);
      setMessage(
        result.code === "CSRF_INVALID"
          ? "Your security check was refreshed. Review and confirm again; nothing was replayed."
          : result.code === "FORBIDDEN"
            ? "This account cannot perform this action."
            : "The request was not accepted. Reload the household and review eligibility, attendance and verification details.",
      );
    } else
      setMessage(
        "We could not confirm the result. Check this operation before recording another arrival.",
      );
  }
  useEffect(() => {
    let active = true;
    void loadEvents().then((result) => {
      if (!active) return;
      if (result.kind === "ok") {
        setEvents(result.data.events);
        if (result.data.events.length === 1)
          setEventId(result.data.events[0]!.id);
      } else
        setMessage("Unable to load reception. Please sign in again or reload.");
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (eventId)
      void api.statistics(eventId).then((result) => {
        if (active && result.kind === "ok") setStatistics(result.data);
      });
    return () => {
      active = false;
    };
  }, [eventId]);
  useEffect(() => {
    function clear() {
      setQr(null);
      setQrEntry("");
      setConfirm(null);
      setUncertain(null);
    }
    window.addEventListener("pagehide", clear);
    window.addEventListener("admin:signout", clear);
    return () => {
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("admin:signout", clear);
    };
  }, []);
  async function read(action: () => Promise<api.Result<ReceptionDetail>>) {
    if (lock.current || uncertain) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setReceipt(null);
    const ticket = ++sequence.current;
    try {
      const result = await action();
      if (ticket !== sequence.current) return;
      if (result.kind === "ok") {
        setDetail(result.data);
        setNamed([]);
        setPlusOne(false);
        setChildren(0);
        setReason("");
        setExpected(1);
        setArriving(1);
        setReceipt(null);
        setConfirm(null);
      } else {
        setDetail(null);
        setQr(null);
        fail(result);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function find(nextPage = 1) {
    if (lock.current || uncertain || query.trim().length < 2 || !eventId)
      return;
    lock.current = true;
    setBusy(true);
    setDetail(null);
    setQr(null);
    setReceipt(null);
    setMessage("");
    try {
      const result = await api.search(query.trim(), eventId, nextPage);
      if (result.kind === "ok") {
        setResults(result.data);
        setPage(nextPage);
      } else fail(result);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(body: ReceptionArrivalRequest) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setConfirm(null);
    setMessage("");
    setReceipt(null);
    try {
      const result = await api.arrive(body, csrf);
      if (result.kind === "ok") {
        setUncertain(null);
        setReceipt(result.data.arrival);
        const refreshed = await api.detail(body.invitationId, body.eventId);
        if (refreshed.kind === "ok") setDetail(refreshed.data);
        else {
          setDetail(null);
          fail(refreshed);
        }
        const stats = await api.statistics(body.eventId);
        if (stats.kind === "ok") setStatistics(stats.data);
      } else if (result.kind === "uncertain") {
        setUncertain(body);
        setNotFoundOperation(false);
        fail(result);
      } else {
        setUncertain(null);
        fail(result);
        setDetail(null);
        setQr(null);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function recover() {
    if (!uncertain || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const result = await api.operation(
        uncertain.operationId,
        uncertain.invitationId,
        uncertain.eventId,
      );
      if (result.kind === "ok" && result.data.arrival) {
        setReceipt(result.data.arrival);
        setUncertain(null);
        const current = await api.detail(
          uncertain.invitationId,
          uncertain.eventId,
        );
        if (current.kind === "ok") setDetail(current.data);
        else setDetail(null);
        const stats = await api.statistics(uncertain.eventId);
        if (stats.kind === "ok") setStatistics(stats.data);
        setMessage(
          "The recorded arrival was recovered. No extra arrival was created.",
        );
      } else if (result.kind === "ok") {
        setNotFoundOperation(true);
        setMessage(
          "No receipt is recorded yet. The earlier request may still finish. You may explicitly re-submit the same operation safely.",
        );
      } else fail(result);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const h = detail?.household;
  const onSite = !!h && h.rsvpStatus !== "ACCEPTED";
  const selectedCount = named.length + (plusOne ? 1 : 0) + children;
  function prepare() {
    if (!h || blocked || !h.eligible) return;
    if (
      !Number.isSafeInteger(arriving) ||
      arriving < 1 ||
      arriving > (onSite ? expected : h.remainingCount)
    ) {
      setMessage("Review the arriving guest count and remaining allowance.");
      return;
    }
    if (
      onSite &&
      (h.rsvpLocked ||
        !Number.isSafeInteger(expected) ||
        expected < 1 ||
        expected > selectedCount ||
        reason.trim().length < 3)
    ) {
      setMessage(
        "Select the expected guests, confirm expected attendance and provide a verification reason before checking in.",
      );
      return;
    }
    const body: ReceptionArrivalRequest = {
      operationId: crypto.randomUUID(),
      invitationId: h.id,
      eventId,
      attendeeCount: arriving,
      method: qr ? "QR" : "MANUAL",
      verificationMethod: qr ? "QR" : verification,
      ...(qr ? { qrPayload: qr } : {}),
      ...(onSite
        ? {
            onSite: {
              status: "ACCEPTED",
              expectedVersion: h.rsvpVersion,
              attendees: [
                ...named.map((inviteeId) => ({
                  type: "NAMED_INVITEE" as const,
                  inviteeId,
                  quantity: 1,
                })),
                ...(plusOne
                  ? [{ type: "PLUS_ONE" as const, quantity: 1 }]
                  : []),
                ...(children
                  ? [{ type: "ADDITIONAL_CHILD" as const, quantity: children }]
                  : []),
              ],
              eventSelections: [
                { eventId, attending: true, expectedAttendeeCount: expected },
              ],
              dietaryNotes: null,
              reason: reason.trim(),
            },
          }
        : {}),
    };
    setConfirm(body);
    setMessage("");
  }
  return (
    <div className="reception-workspace">
      <label>
        Wedding event
        <select
          value={eventId}
          disabled={blocked || confirm !== null}
          onChange={(e) => {
            ++sequence.current;
            setEventId(e.target.value);
            setDetail(null);
            setQr(null);
            setResults(null);
            setReceipt(null);
          }}
        >
          <option value="">Select wedding event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label="Reception actions">
        {[
          ["scan", "Scan QR"],
          ["find", "Find Guest"],
          ["help", "Guest Assistance"],
        ].map(([value, label]) => (
          <button
            key={value}
            disabled={blocked || !!confirm}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value as typeof mode);
              setDetail(null);
              setQr(null);
              setResults(null);
              setReceipt(null);
              setMessage("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {message ? (
        <p role="alert" className="notice">
          {message}
        </p>
      ) : null}
      {busy ? <p role="status">Working…</p> : null}
      {uncertain ? (
        <section className="import-panel">
          <h2>Confirmation needs recovery</h2>
          <p>Do not record another arrival until this operation is resolved.</p>
          <button disabled={busy} onClick={() => void recover()}>
            Check operation status
          </button>
          {notFoundOperation ? (
            <button disabled={busy} onClick={() => void save(uncertain)}>
              Re-submit same operation
            </button>
          ) : null}
        </section>
      ) : null}
      {receipt ? (
        <section className="import-panel" role="status">
          <h2>Arrival recorded</h2>
          <p>
            {receipt.attendeeCount} guests added · {receipt.totalAfter} /{" "}
            {receipt.expectedAttendeeCount} arrived
          </p>
          <p>{wib.format(new Date(receipt.checkedInAt))} WIB</p>
        </section>
      ) : null}
      {mode === "help" ? (
        <section className="import-panel">
          <h2>Guest Assistance</h2>
          <p>
            Check the invitation card, spelling, household name or printed
            reference with the guest. Registration for guests who are not in the
            list is reserved for the next phase. No household will be created
            here.
          </p>
        </section>
      ) : null}
      {mode === "find" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void find();
          }}
          className="import-panel"
        >
          <label>
            Guest name or invitation reference
            <input
              maxLength={100}
              minLength={2}
              value={query}
              disabled={blocked || !!confirm}
              onChange={(event) => setQuery(event.target.value)}
              required
            />
          </label>
          <button disabled={blocked || !eventId || !!confirm}>
            Find registered guests
          </button>
        </form>
      ) : null}
      {mode === "scan" ? (
        <section className="import-panel">
          <CheckinCamera
            disabled={blocked || !eventId || !!detail || !!confirm}
            onStart={() => {
              setQr(null);
              setDetail(null);
            }}
            onDecode={(payload) => {
              setQr(payload);
              void read(() => api.identify(payload, eventId, csrf));
            }}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const payload = qrEntry;
              setQrEntry("");
              setQr(payload);
              void read(() => api.identify(payload, eventId, csrf));
            }}
          >
            <label>
              Guest check-in QR code
              <input
                type="password"
                autoComplete="off"
                value={qrEntry}
                maxLength={43}
                minLength={43}
                pattern="[A-Za-z0-9_-]{43}"
                onChange={(event) => setQrEntry(event.target.value)}
                disabled={blocked || !!confirm}
                required
              />
            </label>
            <button disabled={blocked || !eventId || !!confirm}>
              Validate guest QR
            </button>
          </form>
        </section>
      ) : null}
      {mode === "find" && results ? (
        <section className="import-panel">
          <h2>Registered households</h2>
          {results.items.length ? (
            results.items.map((item) => (
              <button
                key={item.id}
                disabled={blocked || !!confirm}
                onClick={() => {
                  setQr(null);
                  void read(() => api.detail(item.id, eventId));
                }}
              >
                {item.displayName} · {item.referenceCode} · {item.rsvpStatus} ·{" "}
                {item.arrivedCount}/{item.expectedCount} arrived
                {!item.eligible ? " · Not eligible" : ""}
              </button>
            ))
          ) : (
            <p>
              No guest found. Use Guest Assistance to verify the card and
              household; no registration was created.
            </p>
          )}
          <div>
            <button
              disabled={blocked || page === 1 || !!confirm}
              onClick={() => void find(page - 1)}
            >
              Previous results
            </button>
            <button
              disabled={blocked || !results.hasMore || !!confirm}
              onClick={() => void find(page + 1)}
            >
              Next results
            </button>
          </div>
        </section>
      ) : null}
      {h ? (
        <section
          className="import-panel reception-household"
          aria-label="Household reception detail"
        >
          <h2>{h.displayName}</h2>
          <p>
            Invitation reference: <strong>{h.referenceCode}</strong>
          </p>
          <dl>
            <div>
              <dt>RSVP</dt>
              <dd>{h.rsvpStatus}</dd>
            </div>
            <div>
              <dt>Eligibility</dt>
              <dd>
                {h.eligible ? "Eligible" : "Not eligible — no check-in allowed"}
              </dd>
            </div>
            <div>
              <dt>Invitation allowance</dt>
              <dd>{h.allowedCount}</dd>
            </div>
            <div>
              <dt>Expected guests</dt>
              <dd>{h.expectedCount}</dd>
            </div>
            <div>
              <dt>Already arrived</dt>
              <dd>{h.arrivedCount}</dd>
            </div>
            <div>
              <dt>Remaining expected guests</dt>
              <dd>{h.remainingCount}</dd>
            </div>
          </dl>
          {h.eligible &&
          ((!h.rsvpLocked && onSite) || (!onSite && h.remainingCount > 0)) ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                prepare();
              }}
            >
              <fieldset disabled={blocked || !!confirm}>
                {onSite ? (
                  <>
                    <h3>
                      {h.rsvpStatus === "DECLINED"
                        ? "Confirm changed plans at reception"
                        : "Confirm RSVP at reception"}
                    </h3>
                    <p>
                      Choose the people expected to attend. This does not mark
                      them all as arrived.
                    </p>
                    {h.invitees.map((person) => (
                      <label key={person.id}>
                        <input
                          type="checkbox"
                          checked={named.includes(person.id)}
                          onChange={(e) =>
                            setNamed(
                              e.target.checked
                                ? [...named, person.id]
                                : named.filter((id) => id !== person.id),
                            )
                          }
                        />
                        {person.fullName}
                      </label>
                    ))}
                    {h.allowPlusOne ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={plusOne}
                          onChange={(e) => setPlusOne(e.target.checked)}
                        />
                        One plus-one guest
                      </label>
                    ) : null}
                    {h.maxAdditionalChildren > 0 ? (
                      <label>
                        Additional children
                        <input
                          type="number"
                          min={0}
                          max={h.maxAdditionalChildren}
                          value={children}
                          onChange={(e) => setChildren(e.target.valueAsNumber)}
                        />
                      </label>
                    ) : null}
                    <label>
                      Expected attendance confirmed by guest
                      <input
                        type="number"
                        min={1}
                        max={selectedCount}
                        value={expected}
                        onChange={(e) => setExpected(e.target.valueAsNumber)}
                        required
                      />
                    </label>
                    <p>Selected guest allowance: {selectedCount}</p>
                    <label>
                      Verification / changed-plans reason
                      <textarea
                        minLength={3}
                        maxLength={500}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required
                      />
                    </label>
                  </>
                ) : null}
                {!qr ? (
                  <label>
                    Guest verification
                    <select
                      value={verification}
                      onChange={(e) =>
                        setVerification(e.target.value as typeof verification)
                      }
                    >
                      <option value="PHYSICAL_INVITATION">
                        Physical invitation card checked
                      </option>
                      <option value="HOUSEHOLD_DETAILS">
                        Household details verified with guest
                      </option>
                    </select>
                  </label>
                ) : null}
                <label>
                  Guests arriving now
                  <input
                    type="number"
                    min={1}
                    max={onSite ? expected : h.remainingCount}
                    value={arriving}
                    onChange={(e) => setArriving(e.target.valueAsNumber)}
                    required
                  />
                </label>
                <button>
                  {onSite
                    ? "Confirm RSVP & Check-in"
                    : h.arrivedCount > 0
                      ? "Record additional arrival"
                      : "Check-in"}
                </button>
              </fieldset>
            </form>
          ) : h.expectedCount > 0 && h.remainingCount === 0 ? (
            <p role="status">
              Fully checked in. No further arrivals can be recorded.
            </p>
          ) : (
            <p>Reception changes are unavailable for this household.</p>
          )}
          <h3>Arrival history</h3>
          {detail.arrivals.length ? (
            <ol>
              {detail.arrivals.map((item) => (
                <li key={item.operationId}>
                  {item.attendeeCount} guests · {item.method} · {item.actorRole}{" "}
                  · {wib.format(new Date(item.checkedInAt))} WIB
                  {item.migrated ? " · Migrated existing check-in" : ""}
                  {item.reason ? ` · ${item.reason}` : ""}
                </li>
              ))}
            </ol>
          ) : (
            <p>No arrivals recorded.</p>
          )}
          <button
            disabled={blocked || !!confirm}
            onClick={() => void read(() => api.detail(h.id, eventId))}
          >
            Reload household
          </button>
        </section>
      ) : null}
      {confirm ? (
        <ArrivalConfirmation
          body={confirm}
          name={h?.displayName ?? "Household"}
          onConfirm={() => void save(confirm)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {statistics ? (
        <section className="import-panel">
          <h2>Reception statistics</h2>
          <p>
            Expected guests: {statistics.expectedGuests} · Actual arrived:{" "}
            {statistics.arrivedGuests}
          </p>
          <p>
            Registered households: {statistics.registeredHouseholds} · Pending:{" "}
            {statistics.pendingHouseholds} · Accepted:{" "}
            {statistics.acceptedHouseholds} · Declined:{" "}
            {statistics.declinedHouseholds}
          </p>
          <p>
            Partial households: {statistics.partialHouseholds} · Completed
            households: {statistics.completedHouseholds}
          </p>
          <p>
            QR guests: {statistics.qrGuests} · Manual guests:{" "}
            {statistics.manualGuests} · On-site RSVP confirmations:{" "}
            {statistics.onSiteConfirmations}
          </p>
        </section>
      ) : null}
    </div>
  );
}
