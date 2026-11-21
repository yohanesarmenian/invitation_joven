"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  readWibMinuteAtSave,
  readWibMinuteEdit,
  toWibMinute,
  wibMinuteTimestamp,
  type WibMinuteEdit,
} from "../src/forms/wib-date-time";
import {
  rsvpPolicy,
  saveRsvpPolicy,
  type RsvpPolicy,
} from "../src/reports/client";

const wib = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function RsvpPolicySettings({ csrfToken }: { csrfToken: string }) {
  const [policy, setPolicy] = useState<RsvpPolicy>();
  const [late, setLate] = useState(false);
  const [initialEdit, setInitialEdit] = useState<WibMinuteEdit>();
  const [finalEdit, setFinalEdit] = useState<WibMinuteEdit>();
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const initialInput = useRef<HTMLInputElement>(null);
  const finalInput = useRef<HTMLInputElement>(null);
  const locked = useRef(false);

  useEffect(() => {
    let active = true;
    void rsvpPolicy().then((result) => {
      if (!active) return;
      if (result.kind === "ok") {
        setPolicy(result.data);
        setLate(result.data.allowLateEdits);
        setInitialEdit(undefined);
        setFinalEdit(undefined);
      } else {
        setFeedback("Could not load RSVP settings. Reload to try again.");
      }
    });
    return () => {
      active = false;
    };
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || locked.current) return;
    const initial = readWibMinuteAtSave(
      initialInput.current,
      policy.initialDeadlineAt,
      initialEdit,
    );
    const final = late
      ? readWibMinuteAtSave(
          finalInput.current,
          policy.finalEditDeadlineAt,
          finalEdit,
        )
      : undefined;
    if (initial?.kind === "invalid" || final?.kind === "invalid") {
      setFeedback(
        "Enter complete WIB dates and times or use the Clear buttons.",
      );
      return;
    }
    const initialDeadlineAt = wibMinuteTimestamp(
      policy.initialDeadlineAt,
      initial,
      null,
    );
    const finalEditDeadlineAt = late
      ? wibMinuteTimestamp(policy.finalEditDeadlineAt, final, null)
      : null;
    if (
      finalEditDeadlineAt &&
      (!initialDeadlineAt || finalEditDeadlineAt < initialDeadlineAt)
    ) {
      setFeedback(
        "Set a wedding default deadline at or before the final edit deadline.",
      );
      return;
    }
    locked.current = true;
    setPending(true);
    const result = await saveRsvpPolicy(
      {
        initialDeadlineAt,
        finalEditDeadlineAt,
        allowLateEdits: late,
        expectedVersion: policy.version,
      },
      csrfToken,
    );
    locked.current = false;
    setPending(false);
    if (result.kind === "ok") {
      setPolicy(result.data);
      setLate(result.data.allowLateEdits);
      setInitialEdit(undefined);
      setFinalEdit(undefined);
      setFeedback("RSVP settings saved.");
    } else {
      setFeedback(
        "Settings could not be confirmed. Reload and review the saved settings before trying again.",
      );
    }
  }

  return (
    <section className="import-panel" aria-labelledby="rsvp-policy-title">
      <h2 id="rsvp-policy-title">RSVP settings</h2>
      <p>
        Times are in WIB. An explicit invitation deadline takes precedence.
        Invitations without one follow the wedding default.
      </p>
      {policy ? (
        <>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <fieldset disabled={pending}>
              <legend>Online RSVP deadlines</legend>
              <label>
                Initial RSVP deadline (WIB)
                <input
                  type="datetime-local"
                  step={60}
                  ref={initialInput}
                  value={
                    initialEdit?.input ?? toWibMinute(policy.initialDeadlineAt)
                  }
                  onChange={(event) =>
                    setInitialEdit(readWibMinuteEdit(event.currentTarget))
                  }
                />
              </label>{" "}
              <button
                type="button"
                onClick={() => setInitialEdit({ kind: "clear", input: "" })}
              >
                Clear initial deadline
              </button>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={late}
                  onChange={(event) => setLate(event.currentTarget.checked)}
                />
                Allow previous respondents to edit after their initial deadline
              </label>
              {late && (
                <>
                  <label>
                    Final late-edit deadline (WIB)
                    <input
                      type="datetime-local"
                      step={60}
                      ref={finalInput}
                      value={
                        finalEdit?.input ??
                        toWibMinute(policy.finalEditDeadlineAt)
                      }
                      onChange={(event) =>
                        setFinalEdit(readWibMinuteEdit(event.currentTarget))
                      }
                    />
                  </label>{" "}
                  <button
                    type="button"
                    onClick={() => setFinalEdit({ kind: "clear", input: "" })}
                  >
                    Clear final deadline
                  </button>
                  <p>
                    A blank final deadline leaves late edits open until
                    check-in. An invitation with a later initial deadline keeps
                    its original RSVP window.
                  </p>
                </>
              )}
              <p>
                After the first check-in, the household’s RSVP is locked.
                Reception staff can assist on site.
              </p>
              <button type="submit">
                {pending ? "Saving…" : "Save RSVP settings"}
              </button>
            </fieldset>
          </form>
          <h3>
            Active invitations with explicit deadlines (
            {policy.activeExceptionCount})
          </h3>
          {policy.activeExceptions.length ? (
            <ul>
              {policy.activeExceptions.map((invitation) => (
                <li key={invitation.id}>
                  <Link href={`/invitations/${invitation.id}/edit`}>
                    {invitation.displayName}
                  </Link>
                  {" · "}
                  {wib.format(new Date(invitation.rsvpDeadlineAt))} WIB
                </li>
              ))}
            </ul>
          ) : (
            <p>All active invitations follow the wedding default.</p>
          )}
          {policy.activeExceptionCount > policy.activeExceptions.length && (
            <p>
              Showing the first {policy.activeExceptions.length}.{" "}
              <Link href="/invitations">View invitations</Link>
            </p>
          )}
        </>
      ) : feedback ? null : (
        <p role="status">Loading RSVP settings…</p>
      )}
      {feedback && <p role="status">{feedback}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPolicy(undefined);
          setFeedback("");
          setReload((value) => value + 1);
        }}
      >
        Reload settings
      </button>
    </section>
  );
}
