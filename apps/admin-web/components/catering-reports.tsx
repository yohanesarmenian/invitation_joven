"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  cateringComparison,
  cateringLive,
  cateringSnapshots,
  freezeCatering,
  type CateringComparison,
  type CateringLive,
  type CateringSnapshot,
  type FreezeCatering,
} from "../src/reports/client";
import { RsvpPolicySettings } from "./rsvp-policy-settings";

const wib = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});
const stamp = (value: string) => wib.format(new Date(value)) + " WIB";

function HouseholdTotals({ data }: { data: CateringLive["totals"] }) {
  return (
    <p>
      {data.households} households · {data.namedInvitees} named invitees ·{" "}
      {data.accepted} accepted · {data.declined} declined · {data.pending}{" "}
      pending
    </p>
  );
}

function exportLinks(version: number) {
  const path = `/api/admin/reports/catering/snapshots/${version}/export?kind=`;
  return (
    <ul>
      <li>
        <a href={path + "summary"} download>
          Export frozen summary CSV
        </a>
      </li>
      <li>
        <a href={path + "households"} download>
          Export frozen household and session CSV
        </a>
      </li>
      <li>
        <a href={path + "changes"} download>
          Export changes CSV
        </a>
      </li>
    </ul>
  );
}

export function CateringReports({ csrfToken }: { csrfToken: string }) {
  const [eventId, setEventId] = useState("");
  const [archived, setArchived] = useState(false);
  const [live, setLive] = useState<CateringLive>();
  const [events, setEvents] = useState<CateringLive["totals"]["events"]>([]);
  const [snapshots, setSnapshots] = useState<CateringSnapshot[]>();
  const [version, setVersion] = useState(0);
  const [comparison, setComparison] = useState<CateringComparison>();
  const [view, setView] = useState<"LIVE" | "FROZEN" | "CHANGES">("LIVE");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [compareError, setCompareError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<FreezeCatering>();
  const [conflictVersion, setConflictVersion] = useState<number>();
  const locking = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      cateringLive({
        archived: archived ? "include" : "exclude",
        ...(eventId ? { eventId } : {}),
      }),
      cateringSnapshots(),
    ]).then(([current, history]) => {
      if (!active) return;
      if (current.kind === "ok") {
        setLive(current.data);
        if (!eventId) setEvents(current.data.totals.events);
      } else setLive(undefined);
      if (history.kind === "ok") {
        setSnapshots(history.data);
        setVersion((value) => value || history.data[0]?.version || 0);
      } else setSnapshots(undefined);
      setError(
        current.kind === "ok" && history.kind === "ok"
          ? ""
          : "Could not load catering reports. Refresh to try again.",
      );
    });
    return () => {
      active = false;
    };
  }, [archived, eventId, refresh]);

  useEffect(() => {
    if (!version) return;
    let active = true;
    void cateringComparison(version).then((result) => {
      if (!active) return;
      setCompareError(result.kind !== "ok");
      setComparison(result.kind === "ok" ? result.data : undefined);
    });
    return () => {
      active = false;
    };
  }, [version, refresh]);

  async function freeze() {
    if (locking.current || conflictVersion !== undefined) return;
    let request = uncertain;
    if (!request) {
      if (!snapshots || !liveMatches) return;
      request = {
        operationId: crypto.randomUUID(),
        eventId: eventId || null,
        includeArchived: archived,
        expectedVersion: snapshots[0]?.version ?? 0,
      };
    }
    locking.current = true;
    setBusy(true);
    const result = await freezeCatering(request, csrfToken);
    locking.current = false;
    setBusy(false);
    setRefresh((value) => value + 1);
    if (result.kind === "ok") {
      setUncertain(undefined);
      setVersion(result.data.version);
      setView("FROZEN");
      setFeedback(
        `Catering snapshot V${result.data.version} was saved at ${stamp(result.data.capturedAt)}.`,
      );
    } else if (result.kind === "version-conflict") {
      setUncertain(undefined);
      setConflictVersion(result.latestVersion);
      setFeedback(
        `Another catering snapshot was created. Your freeze was not applied. V${result.latestVersion} was the latest version when checked.`,
      );
    } else if (result.kind === "uncertain" || uncertain) {
      setUncertain(request);
      setFeedback(
        result.kind === "rejected"
          ? "The check was rejected. Verify your session before checking the original freeze again."
          : "The snapshot may have been saved. Check the original freeze before creating another snapshot.",
      );
    } else {
      setFeedback(
        "Freeze request was rejected. Review the refreshed versions and verify your session before creating another.",
      );
    }
  }

  const selected =
    comparison?.snapshot.version === version ? comparison : undefined;
  const liveMatches =
    live &&
    live.includeArchived === archived &&
    live.eventId === (eventId || null);
  return (
    <>
      <details className="import-panel">
        <summary>Configure RSVP deadlines</summary>
        <RsvpPolicySettings csrfToken={csrfToken} />
      </details>
      <section className="import-panel" aria-labelledby="catering-reports">
        <h2 id="catering-reports">Catering reports</h2>
        <p>
          Counts represent people per session. One person can appear in more
          than one session.
        </p>
        <div
          className="form-actions"
          role="group"
          aria-label="Catering report view"
        >
          {(["LIVE", "FROZEN", "CHANGES"] as const).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh catering reports
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {feedback && <p role="status">{feedback}</p>}
        {conflictVersion !== undefined && (
          <button
            type="button"
            disabled={!snapshots?.[0] || snapshots[0].version < conflictVersion}
            onClick={() => {
              if (!snapshots?.[0] || snapshots[0].version < conflictVersion)
                return;
              setVersion(snapshots[0].version);
              setView("FROZEN");
              setConflictVersion(undefined);
            }}
          >
            Review Latest Snapshot
          </button>
        )}
        {uncertain && (
          <button type="button" disabled={busy} onClick={() => void freeze()}>
            Check Freeze Result
          </button>
        )}
        {view === "LIVE" ? (
          <>
            <h3>Current RSVP and physical attendance</h3>
            <fieldset disabled={busy || !!uncertain}>
              <legend>Live and next snapshot scope</legend>
              <label>
                Session{" "}
                <select
                  value={eventId}
                  onChange={(event) => setEventId(event.currentTarget.value)}
                >
                  <option value="">All configured sessions</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(event) => setArchived(event.currentTarget.checked)}
                />{" "}
                Include archived households
              </label>
            </fieldset>
            {liveMatches && (
              <>
                <p>
                  Generated {stamp(live.generatedAt)} ·{" "}
                  {archived ? "Archived included" : "Active households only"} ·
                  Catering estimates use expected RSVP quantities. Historical
                  digital attendance excludes the physical guestbook.
                </p>
                <HouseholdTotals data={live.totals} />
                <div className="report-table-scroll">
                  <table>
                    <caption>Live counts by session</caption>
                    <thead>
                      <tr>
                        <th scope="col">Session</th>
                        <th scope="col">RSVP expected people</th>
                        <th scope="col">Historical capacity adjustments</th>
                        <th scope="col">Adjusted total</th>
                        <th scope="col">Historical actual</th>
                        <th scope="col">Historical partial arrivals</th>
                        <th scope="col">Historical walk-ins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {live.totals.events.map((event) => (
                        <tr key={event.id}>
                          <th scope="row">{event.name}</th>
                          <td>{event.rsvpExpected}</td>
                          <td>{event.capacityAdjustment}</td>
                          <td>{event.expected}</td>
                          <td>{event.actual}</td>
                          <td>{event.partialHouseholds}</td>
                          <td>{event.walkinActual}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  {snapshots?.length
                    ? `Latest official snapshot V${snapshots[0]!.version}.`
                    : snapshots
                      ? "No official snapshot yet."
                      : "Loading snapshot versions…"}
                </p>
                <button
                  type="button"
                  disabled={
                    !snapshots ||
                    !live.totals.events.length ||
                    busy ||
                    !!uncertain ||
                    conflictVersion !== undefined
                  }
                  onClick={() => void freeze()}
                >
                  {busy ? "Freezing…" : "Freeze catering numbers"}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <label>
              Official version{" "}
              <select
                value={version}
                onChange={(event) =>
                  setVersion(Number(event.currentTarget.value))
                }
              >
                {!snapshots?.length && (
                  <option value={0}>No saved versions</option>
                )}
                {snapshots?.map((snapshot) => (
                  <option value={snapshot.version} key={snapshot.version}>
                    V{snapshot.version} · {stamp(snapshot.capturedAt)}
                  </option>
                ))}
              </select>
            </label>
            {compareError && (
              <p role="alert">Could not load the saved comparison.</p>
            )}
            {selected && (
              <>
                <p>
                  V{version} captured {stamp(selected.snapshot.capturedAt)} ·{" "}
                  {selected.snapshot.includeArchived
                    ? "Archived included"
                    : "Active households only"}{" "}
                  · Session scope fixed at capture.
                </p>
                {view === "FROZEN" ? (
                  <HouseholdTotals data={selected.frozen} />
                ) : (
                  <p>
                    Current comparison generated {stamp(selected.generatedAt)}.
                  </p>
                )}
                <div className="report-table-scroll">
                  <table>
                    <caption>
                      {view === "FROZEN"
                        ? "Frozen catering counts"
                        : "Frozen and current expected people by session"}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Session</th>
                        <th scope="col">Frozen expected people</th>
                        {view === "CHANGES" && (
                          <>
                            <th scope="col">Current expected people</th>
                            <th scope="col">Net people</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.frozen.events.map((event, index) => (
                        <tr key={event.id}>
                          <th scope="row">{event.name}</th>
                          <td>{event.expected}</td>
                          {view === "CHANGES" && (
                            <>
                              <td>{selected.live.events[index]?.expected}</td>
                              <td>
                                {(selected.live.events[index]?.expected ?? 0) -
                                  event.expected}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {view === "CHANGES" &&
                  (selected.changes.length ? (
                    <div className="report-table-scroll">
                      <table>
                        <caption>Changes by household and session</caption>
                        <thead>
                          <tr>
                            <th scope="col">Household</th>
                            <th scope="col">Session</th>
                            <th scope="col">RSVP status</th>
                            <th scope="col">Expected people</th>
                            <th scope="col">Changes and evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.changes.map((row) => (
                            <tr key={row.invitationId + "/" + row.eventId}>
                              <th scope="row">
                                <Link href={`/invitations/${row.invitationId}`}>
                                  View household {row.invitationId.slice(0, 8)}
                                </Link>
                              </th>
                              <td>
                                {
                                  selected.frozen.events.find(
                                    (event) => event.id === row.eventId,
                                  )?.name
                                }
                              </td>
                              <td>
                                {row.previousStatus ?? "Outside scope"} →{" "}
                                {row.currentStatus ?? "Outside scope"}
                              </td>
                              <td>
                                {row.frozenExpected} → {row.currentExpected} (
                                {row.netChange > 0 ? "+" : ""}
                                {row.netChange})
                              </td>
                              <td>
                                {row.changes
                                  .map((item) =>
                                    item.toLowerCase().replaceAll("_", " "),
                                  )
                                  .join(", ")}
                                .{" "}
                                {row.evidence
                                  .map((item) =>
                                    item.toLowerCase().replaceAll("_", " "),
                                  )
                                  .join(", ")}
                                .
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>No changes in the captured scope.</p>
                  ))}
                {exportLinks(version)}
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
