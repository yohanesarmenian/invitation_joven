"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  WalkinRequest,
  AttendanceActionRequest,
  ReceptionActionReceipt,
  ReceptionDetail,
  ReceptionSearch,
} from "@wedding-invitation/api-client/src/index";
import * as api from "../src/reception/client";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
type Command =
  | { kind: "WALKIN"; body: WalkinRequest }
  | { kind: "CORRECTION" | "EXCEPTION"; body: AttendanceActionRequest };
const verifications = [
  ["PHYSICAL_INVITATION", "Physical invitation card"],
  ["VERBAL_IDENTIFICATION", "Verbal identification"],
  ["FAMILY_REFERENCE", "Family reference"],
  ["OTHER", "Other verification"],
] as const;
function Confirmation({
  command,
  name,
  confirm,
  cancel,
}: {
  command: Command;
  name: string;
  confirm: () => void;
  cancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      className="reception-dialog"
      ref={ref}
      aria-labelledby="assistance-confirm"
      onCancel={cancel}
    >
      <h2 id="assistance-confirm">Confirm reception change</h2>
      <p>{name}</p>
      <p>
        {command.kind === "WALKIN"
          ? `Register ${command.body.expectedCount} expected guests and record ${command.body.arrivingCount} arriving now.`
          : command.kind === "CORRECTION"
            ? `Set the actual attendance total to ${command.body.count}. Original arrival history will be retained.`
            : `Authorize and check in ${command.body.count} additional guests. This increases the operational allowance.`}
      </p>
      <button onClick={confirm}>Confirm change</button>
      <button onClick={cancel}>Cancel</button>
    </dialog>
  );
}
export function ReceptionAssistance({
  eventId,
  csrfToken,
  household,
  disabled,
  onBusy,
  onView,
  onRecorded,
  onNew,
  onReturn,
}: {
  eventId: string;
  csrfToken: string;
  household?: ReceptionDetail["household"];
  disabled: boolean;
  onBusy: (value: boolean) => void;
  onView: (id: string) => Promise<void>;
  onRecorded: (id: string) => Promise<void>;
  onNew?: () => void;
  onReturn: () => void;
}) {
  const router = useRouter(),
    lock = useRef(false);
  const [csrf, setCsrf] = useState(csrfToken),
    [name, setName] = useState(""),
    [arriving, setArriving] = useState(1),
    [expected, setExpected] = useState(1),
    [affiliation, setAffiliation] =
      useState<WalkinRequest["affiliation"]>("OTHER"),
    [verification, setVerification] = useState<
      WalkinRequest["verificationMethod"]
    >("VERBAL_IDENTIFICATION"),
    [reason, setReason] = useState(""),
    [duplicateReason, setDuplicateReason] = useState(""),
    [matches, setMatches] = useState<ReceptionSearch | null>(null),
    [reviewed, setReviewed] = useState(false);
  const [kind, setKind] = useState<"CORRECTION" | "EXCEPTION">("CORRECTION"),
    [method, setMethod] = useState<"MANUAL" | "QR">("MANUAL"),
    [count, setCount] = useState(household?.arrivedCount ?? 0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirmation, setConfirmation] = useState<Command | null>(null),
    [uncertain, setUncertain] = useState<Command | null>(null),
    [absent, setAbsent] = useState(false),
    [receipt, setReceipt] = useState<ReceptionActionReceipt | null>(null);
  const blocked = disabled || busy || !!confirmation || !!uncertain;
  function error(result: Exclude<api.Result<unknown>, { kind: "ok" }>) {
    if (result.kind === "uncertain") {
      setMessage(
        "The result is uncertain. Check the original operation before doing anything else.",
      );
      return;
    }
    if (result.code === "UNAUTHENTICATED") {
      router.replace(SESSION_ENDED_PATH);
      return;
    }
    if (result.csrfToken) setCsrf(result.csrfToken);
    if (result.code === "DUPLICATE_REVIEW_REQUIRED") {
      setMatches(null);
      setReviewed(false);
      setMessage(
        "The guest list changed or a potential match needs review. Check the existing guest list again.",
      );
    } else
      setMessage(
        result.code === "RECEPTION_RATE_LIMIT"
          ? "Too many changes. Pause and review recorded operations."
          : result.code === "CSRF_INVALID"
            ? "Security check refreshed. Review and confirm again; nothing was replayed."
            : "Change was not accepted. Reload the household and check the counts, permission and reason.",
      );
  }
  async function lookup() {
    if (lock.current || !eventId) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setMatches(null);
    setReviewed(false);
    try {
      const result = await api.search(
        name.normalize("NFKC").trim().replace(/\s+/g, " "),
        eventId,
        1,
      );
      if (result.kind === "ok") setMatches(result.data);
      else error(result);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function completed(result: ReceptionActionReceipt) {
    setReceipt(result);
    setUncertain(null);
    setAbsent(false);
    setMessage("");
    await onRecorded(result.invitationId);
  }
  async function save(command: Command) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setConfirmation(null);
    onBusy(true);
    setMessage("");
    let pending = false;
    try {
      const result =
        command.kind === "WALKIN"
          ? await api.registerWalkin(command.body, csrf)
          : await api.adjustAttendance(command.kind, command.body, csrf);
      if (result.kind === "ok") await completed(result.data);
      else if (result.kind === "uncertain") {
        pending = true;
        setUncertain(command);
        setAbsent(false);
        error(result);
      } else {
        setUncertain(null);
        error(result);
      }
    } finally {
      lock.current = false;
      setBusy(false);
      if (!pending) onBusy(false);
    }
  }
  async function recover() {
    if (!uncertain || lock.current) return;
    lock.current = true;
    setBusy(true);
    let resolved = false;
    try {
      const result = await api.actionStatus(uncertain.body.operationId);
      if (result.kind === "ok" && result.data.receipt) {
        await completed(result.data.receipt);
        resolved = true;
      } else if (result.kind === "ok") {
        setAbsent(true);
        setMessage(
          "No confirmed receipt is visible yet. The original request may still finish. Only re-submit the same operation.",
        );
      } else error(result);
    } finally {
      lock.current = false;
      setBusy(false);
      if (resolved) onBusy(false);
    }
  }
  function prepare() {
    if (blocked || !eventId) return;
    const operationId = crypto.randomUUID();
    if (household) {
      if (!household.eligible || !household.rsvpLocked) return;
      setConfirmation({
        kind,
        body: {
          operationId,
          invitationId: household.id,
          eventId,
          expectedRevision: household.attendanceRevision,
          count,
          method: kind === "EXCEPTION" ? "MANUAL" : method,
          verificationMethod: verification,
          reason,
        },
      });
    } else {
      if (!matches || matches.hasMore || !reviewed) return;
      setConfirmation({
        kind: "WALKIN",
        body: {
          operationId,
          eventId,
          leadName: name,
          arrivingCount: arriving,
          expectedCount: expected,
          affiliation,
          verificationMethod: verification,
          reason,
          lookupConfirmed: true,
          reviewedMatchIds: matches.items.map((item) => item.id),
          duplicateOverrideReason: matches.items.length
            ? duplicateReason
            : null,
        },
      });
    }
    onBusy(true);
  }
  function cancel() {
    setConfirmation(null);
    onBusy(false);
  }
  function another() {
    onNew?.();
    setReceipt(null);
    setName("");
    setReason("");
    setMatches(null);
    setReviewed(false);
    setDuplicateReason("");
    setExpected(1);
    setArriving(1);
  }
  return (
    <section
      className="import-panel"
      aria-label={
        household ? "Attendance adjustments" : "Guest Assistance registration"
      }
    >
      <h2>
        {household
          ? "Correct attendance or receive extra guests"
          : "Guest Assistance"}
      </h2>
      {message ? <p role="alert">{message}</p> : null}
      {busy ? <p role="status">Working…</p> : null}
      {uncertain ? (
        <section>
          <h3>Check the original operation</h3>
          <p>
            Do not start another registration or adjustment until this result is
            resolved.
          </p>
          <button disabled={busy} onClick={() => void recover()}>
            Check confirmed operation
          </button>
          {absent ? (
            <button disabled={busy} onClick={() => void save(uncertain)}>
              Re-submit same operation
            </button>
          ) : null}
        </section>
      ) : null}
      {receipt ? (
        <section role="status">
          <h3>
            {receipt.kind === "WALKIN"
              ? "Guest Registered & Checked In"
              : receipt.kind === "CORRECTION"
                ? "Attendance corrected"
                : "Additional guests recorded"}
          </h3>
          <p>Guest: {receipt.displayName}</p>
          <p>Reference: {receipt.referenceCode}</p>
          <p>
            Arrived: {receipt.arrivedCount} guests · Expected:{" "}
            {receipt.expectedCount} guests · Remaining: {receipt.remainingCount}
          </p>
          <p>
            Source:{" "}
            {receipt.kind === "WALKIN" || household?.source === "WALKIN"
              ? "Walk-in"
              : "Registered household"}{" "}
            · Recorded by reception operator · Status: Confirmed
          </p>
          <button
            disabled={blocked}
            onClick={() => void onView(receipt.invitationId)}
          >
            View household
          </button>
          <button disabled={blocked} onClick={onReturn}>
            Return to reception
          </button>
          {!household ? (
            <button disabled={blocked} onClick={another}>
              Register another guest
            </button>
          ) : (
            <button
              disabled={blocked}
              onClick={() => {
                setReceipt(null);
                setCount(household.arrivedCount);
                setReason("");
              }}
            >
              Record another change
            </button>
          )}
        </section>
      ) : null}
      {!receipt ? (
        <>
          <p>
            {household
              ? `Current actual attendance: ${household.arrivedCount}. Saved RSVP expected: ${household.baseExpectedCount}. Operational allowance: ${household.expectedCount}.`
              : "Search first. A physical card does not mean a new household should be created. Only the lead guest needs a name; unnamed companions are recorded as a group, without assuming their ages."}
          </p>
          {!household ? (
            <>
              <label>
                Lead guest or household name
                <input
                  value={name}
                  minLength={2}
                  maxLength={100}
                  disabled={blocked}
                  onChange={(e) => {
                    setName(e.target.value);
                    setMatches(null);
                    setReviewed(false);
                  }}
                />
              </label>
              <button
                disabled={blocked || name.trim().length < 2 || !eventId}
                onClick={() => void lookup()}
              >
                Check existing guest list
              </button>
              {matches ? (
                <section aria-label="Potential matching households">
                  <h3>Potential matching households</h3>
                  {matches.items.length ? (
                    matches.items.map((item) => (
                      <button
                        key={item.id}
                        disabled={blocked}
                        onClick={() => void onView(item.id)}
                      >
                        {item.displayName} · {item.referenceCode} · Open
                        existing household
                      </button>
                    ))
                  ) : (
                    <p>No potential matches found.</p>
                  )}
                  {matches.hasMore ? (
                    <p>
                      Too many matches. Refine the name and search again before
                      registering.
                    </p>
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={blocked}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      I checked the guest list and verified this is an
                      unregistered household
                    </label>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              prepare();
            }}
          >
            <fieldset
              disabled={
                blocked ||
                !eventId ||
                (!household && (!matches || !reviewed || matches.hasMore))
              }
            >
              {household ? (
                <>
                  <label>
                    Reception change
                    <select
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value as typeof kind);
                        setCount(
                          e.target.value === "EXCEPTION"
                            ? 1
                            : household.arrivedCount,
                        );
                      }}
                    >
                      <option value="CORRECTION">Correct recorded total</option>
                      <option value="EXCEPTION">
                        Exceptional additional guests
                      </option>
                    </select>
                  </label>
                  <label>
                    {kind === "CORRECTION"
                      ? "Correct total attendance"
                      : "Additional guests arriving now"}
                    <input
                      type="number"
                      min={kind === "CORRECTION" ? 0 : 1}
                      max={
                        kind === "CORRECTION"
                          ? household.expectedCount
                          : 5 - household.exceptionAllowance
                      }
                      value={count}
                      onChange={(e) => setCount(e.target.valueAsNumber)}
                      required
                    />
                  </label>
                  {kind === "CORRECTION" ? (
                    <label>
                      Arrival method being corrected
                      <select
                        value={method}
                        onChange={(e) =>
                          setMethod(e.target.value as typeof method)
                        }
                      >
                        <option value="MANUAL">Manual arrivals</option>
                        <option value="QR">QR arrivals</option>
                      </select>
                    </label>
                  ) : (
                    <p>
                      Exceptions are limited to five additional guests per
                      household and event in total. Each authorization checks in
                      those extra guests now. Saved RSVP stays unchanged.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <label>
                    People arriving now
                    <input
                      type="number"
                      min={1}
                      max={expected}
                      value={arriving}
                      onChange={(e) => setArriving(e.target.valueAsNumber)}
                      required
                    />
                  </label>
                  <label>
                    Expected total household attendance
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={expected}
                      onChange={(e) => setExpected(e.target.valueAsNumber)}
                      required
                    />
                  </label>
                  <label>
                    Guest affiliation
                    <select
                      value={affiliation}
                      onChange={(e) =>
                        setAffiliation(e.target.value as typeof affiliation)
                      }
                    >
                      <option value="BRIDE_FAMILY">Bride&apos;s family</option>
                      <option value="GROOM_FAMILY">Groom&apos;s family</option>
                      <option value="FRIEND">Friend</option>
                      <option value="COLLEAGUE">Colleague</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  {matches?.items.length ? (
                    <label>
                      Why this is a different household
                      <textarea
                        minLength={3}
                        maxLength={500}
                        required
                        value={duplicateReason}
                        onChange={(e) => setDuplicateReason(e.target.value)}
                      />
                    </label>
                  ) : null}
                </>
              )}
              <label>
                Verification method
                <select
                  value={verification}
                  onChange={(e) =>
                    setVerification(e.target.value as typeof verification)
                  }
                >
                  {verifications.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {household
                  ? "Correction / exception reason"
                  : "Registration reason"}
                <textarea
                  minLength={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
              <button>
                {household
                  ? "Review attendance change"
                  : "Review registration & Check-in"}
              </button>
            </fieldset>
          </form>
        </>
      ) : null}
      {confirmation ? (
        <Confirmation
          command={confirmation}
          name={household?.displayName ?? name}
          confirm={() => void save(confirmation)}
          cancel={cancel}
        />
      ) : null}
    </section>
  );
}
