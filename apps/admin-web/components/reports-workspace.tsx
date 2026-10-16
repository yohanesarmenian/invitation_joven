"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "../src/reports/client";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
export function ReportsWorkspace() {
  const router = useRouter(),
    epoch = useRef(0),
    exportLock = useRef(false);
  const [summary, setSummary] = useState<api.Summary | null>(null),
    [rows, setRows] = useState<api.ReportList | null>(null),
    [eventId, setEvent] = useState(""),
    [archived, setArchived] = useState(false),
    [kind, setKind] = useState<api.ReportKind>("RSVP"),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [exporting, setExporting] = useState(false);
  const [eventOptions, setEventOptions] = useState<api.Summary["events"]>([]);
  useEffect(() => {
    let live = true;
    const filter: api.Filters = {
      archived: archived ? "include" : "exclude",
      ...(eventId ? { eventId } : {}),
    };
    void Promise.all([api.summary(filter), api.list(filter, kind, page)]).then(
      ([s, r]) => {
        if (!live) return;
        setLoading(false);
        if (s.kind === "ok" && r.kind === "ok") {
          setSummary(s.data);
          if (!eventId) setEventOptions(s.data.events);
          setRows(r.data);
          setMessage("");
          return;
        }
        setSummary(null);
        setRows(null);
        if (
          [s, r].some(
            (result) =>
              result.kind === "error" && result.code === "UNAUTHENTICATED",
          )
        ) {
          router.replace(SESSION_ENDED_PATH);
          return;
        }
        setMessage(
          [s, r].some(
            (result) => result.kind === "error" && result.code === "FORBIDDEN",
          )
            ? "Only the OWNER can view reports."
            : "Reports are unavailable. Check the connection and refresh explicitly.",
        );
      },
    );
    return () => {
      live = false;
    };
  }, [archived, eventId, kind, page, reload, router]);
  function changed() {
    epoch.current++;
    setLoading(true);
    setMessage("");
    setPage(1);
  }
  async function download(selected: api.ReportKind | "SUMMARY") {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    const ticket = epoch.current;
    const result = await api.exportCsv(
      {
        archived: archived ? "include" : "exclude",
        ...(eventId ? { eventId } : {}),
      },
      selected,
    );
    exportLock.current = false;
    setExporting(false);
    if (ticket !== epoch.current) return;
    if (result.kind === "error") {
      if (result.code === "UNAUTHENTICATED") router.replace(SESSION_ENDED_PATH);
      else
        setMessage(
          result.code === "REPORT_TOO_LARGE"
            ? "This export is too large. Choose one event before exporting."
            : "CSV export unavailable. Check permission and connection.",
        );
      return;
    }
    const body = result.data.startsWith("\ufeff")
      ? result.data
      : "\ufeff" + result.data;
    const url = URL.createObjectURL(
        new Blob([body], { type: "text/csv;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `wedding-report-${selected.toLowerCase().replaceAll("_", "-")}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      "CSV downloaded for the selected filters. Treat dietary notes and operator details as private.",
    );
  }
  return (
    <div className="checkin-workspace">
      <section className="import-panel">
        <h2>Report filters</h2>
        <label>
          Include archived invitations
          <input
            type="checkbox"
            checked={archived}
            disabled={exporting}
            onChange={(e) => {
              changed();
              setArchived(e.target.checked);
            }}
          />
        </label>
        <label>
          Report event
          <select
            value={eventId}
            disabled={exporting}
            onChange={(e) => {
              changed();
              setEvent(e.target.value);
            }}
          >
            <option value="">All events</option>
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
                {event.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={loading || exporting}
          onClick={() => {
            changed();
            setReload((n) => n + 1);
          }}
        >
          Refresh reports
        </button>
      </section>
      <p role="status">{loading ? "Loading reports…" : message}</p>
      {!loading && summary && rows && (
        <>
          <p>
            Summary refreshed:{" "}
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Jakarta",
              dateStyle: "medium",
              timeStyle: "medium",
            }).format(new Date(summary.generatedAt))}{" "}
            (Jakarta). Separate exports may include newer confirmations.
          </p>
          <section className="import-panel">
            <h2>Expected and actual attendance</h2>
            <p>
              People are counted per event. Totals across events are not unique
              people. Actual attendee composition is not recorded.
            </p>
            <div className="report-table-scroll">
              <table>
                <caption>Attendance per event</caption>
                <thead>
                  <tr>
                    {[
                      "Event",
                      "Expected people",
                      "Actual people",
                      "Expected households",
                      "Checked-in households",
                      "Not-arrived households",
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.events.map((e) => (
                    <tr key={e.id}>
                      <th scope="row">{e.name}</th>
                      <td>{e.expectedAttendeeCount}</td>
                      <td>{e.actualAttendeeCount}</td>
                      <td>{e.expectedHouseholds}</td>
                      <td>{e.checkedInHouseholds}</td>
                      <td>{e.notArrivedHouseholds}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.events.length === 0 && (
              <p>No events match these filters.</p>
            )}
            <button
              disabled={exporting}
              onClick={() => void download("SUMMARY")}
            >
              Export event summary CSV
            </button>
          </section>
          <section className="import-panel">
            <h2>Household details</h2>
            <label>
              Report type
              <select
                value={kind}
                disabled={exporting}
                onChange={(e) => {
                  changed();
                  setKind(e.target.value as api.ReportKind);
                }}
              >
                <option value="RSVP">RSVP and dietary</option>
                <option value="CHECKIN">Confirmed check-ins</option>
                <option value="NOT_ARRIVED">Not arrived</option>
              </select>
            </label>
            {rows.items.length === 0 ? (
              <p>No households match these filters.</p>
            ) : (
              <div className="report-table-scroll">
                <table>
                  <caption>
                    {kind === "RSVP"
                      ? "One row per household"
                      : "One row per household and event"}
                  </caption>
                  <thead>
                    <tr>
                      {[
                        "Household",
                        "RSVP",
                        "Intended household size",
                        "Dietary notes",
                        "Event",
                        "Expected",
                        "Actual",
                        "Confirmed at (Jakarta)",
                        "Method / operator",
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.items.map((r) => (
                      <tr key={`${r.invitationId}-${r.eventId ?? "rsvp"}`}>
                        <th scope="row">
                          {r.displayName}
                          {r.invitationStatus === "ARCHIVED"
                            ? " (archived)"
                            : ""}
                        </th>
                        <td>{r.rsvpStatus}</td>
                        <td>{r.rsvpHouseholdSize}</td>
                        <td>{r.dietaryNotes ?? "—"}</td>
                        <td>{r.eventName ?? "—"}</td>
                        <td>{r.expectedAttendeeCount ?? "—"}</td>
                        <td>{r.actualAttendeeCount ?? "—"}</td>
                        <td>
                          {r.checkedInAt
                            ? new Intl.DateTimeFormat("en-GB", {
                                timeZone: "Asia/Jakarta",
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(r.checkedInAt))
                            : "—"}
                        </td>
                        <td>
                          {r.method ?? "—"} {r.operatorEmail ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p>
              Page {rows.page.number} of {Math.max(1, rows.page.totalPages)} ·{" "}
              {rows.page.totalItems} rows
            </p>
            <button
              disabled={exporting || page <= 1}
              onClick={() => {
                setLoading(true);
                setPage((n) => n - 1);
              }}
            >
              Previous page
            </button>
            <button
              disabled={exporting || page >= rows.page.totalPages}
              onClick={() => {
                setLoading(true);
                setPage((n) => n + 1);
              }}
            >
              Next page
            </button>
            <button disabled={exporting} onClick={() => void download(kind)}>
              Export household CSV
            </button>
          </section>
        </>
      )}
      {!loading && !summary && (
        <button
          onClick={() => {
            setLoading(true);
            setReload((n) => n + 1);
          }}
        >
          Retry report read
        </button>
      )}
    </div>
  );
}
