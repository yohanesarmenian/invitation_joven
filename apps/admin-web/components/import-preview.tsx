import type { ImportState, ImportAction } from "../src/imports/state";

export function ImportPreview({
  state,
  dispatch,
}: {
  state: ImportState;
  dispatch: (action: ImportAction) => void;
}) {
  const preview = state.preview;
  if (!preview) return null;
  const workbook = preview.templateVersion === 2;
  const namedGuests = preview.rows.reduce(
    (count, row) => count + (row.parsed?.invitees.length ?? 0),
    0,
  );
  const sessionCounts = new Map<string, { name: string; count: number }>();
  let bothSessions = 0;
  if (workbook) {
    for (const { parsed } of preview.rows) {
      if (!parsed) continue;
      if (parsed.eligibleEventSlugs.length === 2) bothSessions++;
      for (const [index, slug] of parsed.eligibleEventSlugs.entries()) {
        const session = sessionCounts.get(slug);
        if (session) session.count++;
        else
          sessionCounts.set(slug, {
            name: parsed.eligibleEventNames?.[index] ?? slug,
            count: 1,
          });
      }
    }
  }
  const blankDeadline = workbook
    ? "Uses the RSVP policy deadline"
    : "No deadline";
  const editable = state.stage === "PREVIEW_READY";
  return (
    <section aria-labelledby="preview-title" className="import-preview">
      <h2 id="preview-title">Household preview</h2>
      <p>
        This is a preview. Invitations are created only after you confirm the
        import.
      </p>
      <dl className="import-summary">
        <div>
          <dt>{workbook ? "Total invitations" : "Total rows"}</dt>
          <dd>{preview.summary.totalRows}</dd>
        </div>
        <div>
          <dt>Valid (including warnings)</dt>
          <dd>{preview.summary.validRows}</dd>
        </div>
        <div>
          <dt>Warning rows</dt>
          <dd>{preview.summary.warningRows}</dd>
        </div>
        <div>
          <dt>Error rows</dt>
          <dd>{preview.summary.errorRows}</dd>
        </div>
        {workbook && (
          <div>
            <dt>Named guests on valid rows</dt>
            <dd>{namedGuests}</dd>
          </div>
        )}
        <div>
          <dt>Selected households</dt>
          <dd>{state.selected.length}</dd>
        </div>
      </dl>
      {workbook && sessionCounts.size > 0 && (
        <>
          <h3>Sessions on valid rows</h3>
          <ul>
            {[...sessionCounts].map(([slug, session]) => (
              <li key={slug}>
                {session.name}: {session.count}
              </li>
            ))}
          </ul>
          <p>
            {bothSessions} invitations include two sessions. Each is counted
            under both sessions.
          </p>
        </>
      )}
      <p>
        Preview expires:{" "}
        <time dateTime={preview.expiresAt}>{preview.expiresAt}</time> (UTC).
      </p>
      <ol className="import-rows" aria-label="Preview households">
        {preview.rows.map((row) => (
          <li
            key={row.rowNumber}
            className="import-row"
            aria-labelledby={`row-title-${row.rowNumber}`}
          >
            <header>
              <h3 id={`row-title-${row.rowNumber}`}>
                {workbook ? "Invitations row" : "Row"} {row.rowNumber}
                {row.parsed ? ` — ${row.parsed.displayName}` : ""}
              </h3>
              <strong className={`import-status import-status-${row.status}`}>
                {row.status}
              </strong>
            </header>
            {row.parsed && (
              <>
                <dl className="import-settings">
                  <div>
                    <dt>Greeting name</dt>
                    <dd>{row.parsed.greetingName ?? "Not set"}</dd>
                  </div>
                  <div>
                    <dt>Allow plus one</dt>
                    <dd>{row.parsed.allowPlusOne ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Maximum additional children</dt>
                    <dd>{row.parsed.maxAdditionalChildren}</dd>
                  </div>
                  <div>
                    <dt>RSVP deadline (Asia/Jakarta)</dt>
                    <dd>{row.parsed.rsvpDeadlineLocal ?? blankDeadline}</dd>
                  </div>
                  <div>
                    <dt>RSVP deadline (UTC)</dt>
                    <dd>{row.parsed.rsvpDeadlineAt ?? blankDeadline}</dd>
                  </div>
                  <div>
                    <dt>
                      {workbook
                        ? "Eligible wedding sessions"
                        : "Eligible event slugs"}
                    </dt>
                    <dd>
                      {(
                        row.parsed.eligibleEventNames ??
                        row.parsed.eligibleEventSlugs
                      ).join(", ") || "None"}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>
                    Invitees ({row.parsed.invitees.length}) — row{" "}
                    {row.rowNumber}
                  </summary>
                  <ol>
                    {row.parsed.invitees.map((i, index) => (
                      <li key={index}>
                        {i.fullName} · {i.category}
                        {i.label !== null ? ` · ${i.label}` : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              </>
            )}
            <div id={`issues-${row.rowNumber}`}>
              {row.errors.length > 0 && (
                <>
                  <h4>Errors</h4>
                  <ul>
                    {row.errors.map((issue, index) => (
                      <li key={index}>
                        <strong>{issue.code}</strong>
                        {issue.column
                          ? ` · Column: ${issue.column}`
                          : " · Whole row"}
                        {issue.field === "eventIds"
                          ? " · Wedding sessions"
                          : issue.field
                            ? ` · Field: ${issue.field}`
                            : ""}
                        : {issue.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {row.warnings.length > 0 && (
                <>
                  <h4>Warnings</h4>
                  <ul>
                    {row.warnings.map((issue, index) => (
                      <li key={index}>
                        <strong>{issue.code}</strong>
                        {issue.column
                          ? ` · Column: ${issue.column}`
                          : " · Whole row"}
                        {issue.field ? ` · Field: ${issue.field}` : ""}:{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {row.status === "VALID_WITH_WARNINGS" && (
              <div className="import-warning">
                {row.warnings.some((i) => i.code === "POSSIBLE_DUPLICATE") && (
                  <p>
                    This household may already exist. Importing it creates a NEW
                    Invitation. No automatic merge or update occurs.
                  </p>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={state.acknowledged.includes(row.rowNumber)}
                    disabled={!editable}
                    aria-describedby={`issues-${row.rowNumber}`}
                    onChange={(e) =>
                      dispatch({
                        type: "acknowledge",
                        rowNumber: row.rowNumber,
                        checked: e.target.checked,
                      })
                    }
                  />
                  I acknowledge warnings for row {row.rowNumber}
                </label>
              </div>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={state.selected.includes(row.rowNumber)}
                disabled={
                  !editable ||
                  row.status === "ERROR" ||
                  (row.status === "VALID_WITH_WARNINGS" &&
                    !state.acknowledged.includes(row.rowNumber))
                }
                aria-describedby={`issues-${row.rowNumber}`}
                onChange={(e) =>
                  dispatch({
                    type: "select",
                    rowNumber: row.rowNumber,
                    checked: e.target.checked,
                  })
                }
              />
              Select row {row.rowNumber}
            </label>
          </li>
        ))}
      </ol>
    </section>
  );
}
