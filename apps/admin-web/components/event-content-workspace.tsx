"use client";
import { ActionFeedback, type FeedbackTone } from "./action-feedback";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
import * as api from "../src/event-content/client";
import { VenueInformation } from "../../invitation-web/components/invitation/venue-information";
import { venueFromApi } from "../../invitation-web/src/content/venue-api";
import { toWibMinute, fromWibMinute } from "../src/forms/wib-date-time";

const empty: api.Body = { parking: null, rundown: null };
type Confirm = "publish" | "hide" | { deleteId: string } | null;
export function EventContentWorkspace({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<AdminEventsResponse["events"]>([]);
  const [eventId, setEventId] = useState("");
  const [snapshot, setSnapshot] = useState<api.State | null>(null);
  const [body, setBody] = useState<api.Body>(empty);
  const [csrf, setCsrf] = useState(csrfToken);
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("Choose an event to begin."),
    [confirm, setConfirm] = useState<Confirm>(null);
  const [tone, setTone] = useState<FeedbackTone>("info");
  const [preview, setPreview] = useState<"draft" | "published" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false),
    generation = useRef(0),
    stopped = useRef(false);
  const dirty =
    snapshot !== null &&
    JSON.stringify(body) !== JSON.stringify(snapshot.draft);

  function notice(result: api.Result<unknown>) {
    if (result.kind === "uncertain") {
      setTone("warning");
      setBlocked(true);
      setMessage(
        "The result is uncertain. Reload saved state before another action; do not repeat the mutation blindly.",
      );
      return;
    }
    if (result.kind === "ok") return;
    setTone("error");
    if (result.csrfToken) setCsrf(result.csrfToken);
    if (result.code === "UNAUTHENTICATED") {
      stopped.current = true;
      setSnapshot(null);
      setBody(empty);
      router.replace("/login?session=ended");
      return;
    }
    if (result.code === "409") setBlocked(true);
    setMessage(
      result.code === "409"
        ? "The version changed, an asset is still referenced, or the file limit was reached. Reload saved state to review."
        : result.code === "CSRF_INVALID"
          ? "Session refreshed. No action was replayed; review and try explicitly."
          : result.code === "403"
            ? "Access denied."
            : result.code === "400" || result.code === "413"
              ? "Validation rejected. Check copy, time order, required fields, and file type/size."
              : "Unable to load or save event materials. Try an explicit reload.",
    );
  }
  useEffect(() => {
    let active = true;
    const invalidate = () => {
      generation.current++;
    };
    void api.events().then((result) => {
      if (!active) return;
      if (result.kind === "ok") setCatalog(result.data.events);
      else {
        setTone("error");
        setMessage("Unable to load events. Reload this page.");
      }
    });
    const clear = () => {
      stopped.current = true;
      generation.current++;
      setSnapshot(null);
      setCatalog([]);
      setEventId("");
      setBody(empty);
      setFile(null);
      setPreview(null);
      setConfirm(null);
      setBlocked(true);
      if (uploadInput.current) uploadInput.current.value = "";
    };
    window.addEventListener("admin:signout", clear);
    return () => {
      active = false;
      invalidate();
      window.removeEventListener("admin:signout", clear);
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!stopped.current && (dirty || busy || blocked)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, blocked]);
  useEffect(() => {
    const node = dialog.current;
    if (confirm && node) {
      node.showModal();
      return () => node.close();
    }
  }, [confirm]);
  useEffect(() => {
    const protect = (event: MouseEvent) => {
      if (
        stopped.current ||
        (!dirty && !busy && !blocked) ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.origin !== location.origin ||
        anchor.pathname === location.pathname
      )
        return;
      if (
        busy ||
        blocked ||
        !window.confirm("Leave this page and discard unsaved material changes?")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (busy || blocked) {
          setTone("warning");
          setMessage(
            "Finish the current action or reload saved state before leaving this editor.",
          );
        }
      }
    };
    document.addEventListener("click", protect, true);
    return () => document.removeEventListener("click", protect, true);
  }, [dirty, busy, blocked]);
  async function load(target: string) {
    if (lock.current || stopped.current) return;
    lock.current = true;
    setBusy(true);
    setTone("info");
    setMessage("Loading saved state…");
    setPreview(null);
    setConfirm(null);
    const current = ++generation.current;
    const result = await api.read(target);
    if (current === generation.current && !stopped.current) {
      if (result.kind === "ok" && result.data.eventId === target) {
        setEventId(target);
        setSnapshot(result.data);
        setBody(structuredClone(result.data.draft));
        setBlocked(false);
        setTone("info");
        setMessage("Saved state loaded.");
        setFile(null);
        if (uploadInput.current) uploadInput.current.value = "";
      } else notice(result);
    }
    lock.current = false;
    setBusy(false);
  }
  async function mutate(
    call: () => Promise<api.Result<api.State>>,
    mode: "save" | "upload" | "other" = "other",
  ) {
    if (lock.current || blocked || !snapshot || stopped.current) return;
    lock.current = true;
    setBusy(true);
    setTone("info");
    setMessage("Updating event materials…");
    setConfirm(null);
    setPreview(null);
    const current = generation.current;
    const result = await call();
    if (current === generation.current && !stopped.current) {
      if (
        result.kind === "ok" &&
        result.data.eventId === snapshot.eventId &&
        result.data.version === snapshot.version + 1
      ) {
        setSnapshot(result.data);
        if (mode === "save") setBody(structuredClone(result.data.draft));
        if (mode === "upload") {
          setFile(null);
          if (uploadInput.current) uploadInput.current.value = "";
        }
        setTone("success");
        setMessage(
          mode === "save"
            ? "Draft saved. Published content is unchanged."
            : mode === "upload"
              ? "File uploaded. Select it below, then save the draft."
              : "Saved state updated.",
        );
      } else notice(result.kind === "ok" ? { kind: "uncertain" } : result);
    }
    lock.current = false;
    setBusy(false);
  }
  function change(next: api.Body) {
    setBody(next);
    setTone("info");
    setMessage("Unsaved material changes.");
    setPreview(null);
    setConfirm(null);
  }
  const disabled = busy || blocked;
  const selectedPreview =
    preview === "published"
      ? snapshot?.published
      : preview === "draft"
        ? body
        : null;
  return (
    <section
      className="event-content-workspace"
      aria-label="Event materials editor"
    >
      <p>
        Save drafts separately from published content. All times below use WIB
        (Asia/Jakarta).
      </p>
      <label htmlFor="materials-event">Event</label>
      <select
        id="materials-event"
        value={eventId}
        disabled={busy || dirty || blocked}
        onChange={(e) => {
          if (e.target.value) void load(e.target.value);
        }}
      >
        <option value="">Choose event</option>
        {catalog.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name}
            {event.isActive ? "" : " (inactive)"}
          </option>
        ))}
      </select>
      {eventId ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!dirty && !blocked) void load(eventId);
            else setConfirm({ deleteId: "reload" });
          }}
        >
          Reload saved state
        </button>
      ) : null}
      <ActionFeedback tone={tone}>{message}</ActionFeedback>
      {dirty ? (
        <p>
          Unsaved changes. Save or explicitly reload before switching events or
          publishing.
        </p>
      ) : null}
      {snapshot ? (
        <>
          <p>
            Version {snapshot.version} ·{" "}
            {snapshot.published
              ? "Published snapshot available"
              : "Not published"}
          </p>
          <fieldset disabled={disabled}>
            <legend>Parking</legend>
            <label>
              <input
                type="checkbox"
                checked={body.parking !== null}
                onChange={(e) =>
                  change({
                    ...body,
                    parking: e.target.checked
                      ? {
                          title: "",
                          instructions: [],
                          mapAssetId: null,
                          mapAlt: "",
                          pdfAssetId: null,
                          googleMapsUrl: null,
                        }
                      : null,
                  })
                }
              />
              Include parking guide
            </label>
            {body.parking ? (
              <>
                <label>
                  Parking title
                  <input
                    value={body.parking.title}
                    maxLength={120}
                    onChange={(e) =>
                      change({
                        ...body,
                        parking: { ...body.parking!, title: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Parking instructions (one per line)
                  <textarea
                    value={body.parking.instructions.join("\n")}
                    onChange={(e) =>
                      change({
                        ...body,
                        parking: {
                          ...body.parking!,
                          instructions: e.target.value.split("\n"),
                        },
                      })
                    }
                  />
                </label>
                <label htmlFor="parking-map">Parking map</label>
                <select
                  id="parking-map"
                  value={body.parking.mapAssetId ?? ""}
                  onChange={(e) =>
                    change({
                      ...body,
                      parking: {
                        ...body.parking!,
                        mapAssetId: e.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">No map</option>
                  {snapshot.assets
                    .filter((a) => a.kind === "IMAGE")
                    .map((a, i) => (
                      <option key={a.id} value={a.id}>
                        Image {i + 1} ({Math.ceil(a.byteSize / 1024)} KB)
                      </option>
                    ))}
                </select>
                <label>
                  Map description
                  <input
                    value={body.parking.mapAlt}
                    maxLength={300}
                    onChange={(e) =>
                      change({
                        ...body,
                        parking: { ...body.parking!, mapAlt: e.target.value },
                      })
                    }
                  />
                </label>
                <label htmlFor="parking-pdf">Parking PDF</label>
                <select
                  id="parking-pdf"
                  value={body.parking.pdfAssetId ?? ""}
                  onChange={(e) =>
                    change({
                      ...body,
                      parking: {
                        ...body.parking!,
                        pdfAssetId: e.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">No PDF</option>
                  {snapshot.assets
                    .filter((a) => a.kind === "PDF")
                    .map((a, i) => (
                      <option key={a.id} value={a.id}>
                        PDF {i + 1} ({Math.ceil(a.byteSize / 1024)} KB)
                      </option>
                    ))}
                </select>
                <label>
                  Parking Google Maps URL
                  <input
                    type="url"
                    value={body.parking.googleMapsUrl ?? ""}
                    maxLength={2048}
                    onChange={(e) =>
                      change({
                        ...body,
                        parking: {
                          ...body.parking!,
                          googleMapsUrl: e.target.value || null,
                        },
                      })
                    }
                  />
                </label>
              </>
            ) : null}
          </fieldset>
          <fieldset disabled={disabled}>
            <legend>Guest rundown</legend>
            <label>
              <input
                type="checkbox"
                checked={body.rundown !== null}
                onChange={(e) =>
                  change({
                    ...body,
                    rundown: e.target.checked ? { title: "", items: [] } : null,
                  })
                }
              />
              Include event rundown
            </label>
            {body.rundown ? (
              <>
                <label>
                  Rundown title
                  <input
                    value={body.rundown.title}
                    maxLength={120}
                    onChange={(e) =>
                      change({
                        ...body,
                        rundown: { ...body.rundown!, title: e.target.value },
                      })
                    }
                  />
                </label>
                {body.rundown.items.map((item, index) => (
                  <fieldset key={index}>
                    <legend>Activity {index + 1}</legend>
                    <label>
                      Start (WIB) {index + 1}
                      <input
                        type="datetime-local"
                        step="60"
                        value={localTime(item.startsAt)}
                        onChange={(e) => {
                          const items = [...body.rundown!.items];
                          items[index] = {
                            ...item,
                            startsAt: fromWibMinute(e.target.value) ?? "",
                          };
                          change({
                            ...body,
                            rundown: { ...body.rundown!, items },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Activity title {index + 1}
                      <input
                        value={item.title}
                        maxLength={120}
                        onChange={(e) => {
                          const items = [...body.rundown!.items];
                          items[index] = { ...item, title: e.target.value };
                          change({
                            ...body,
                            rundown: { ...body.rundown!, items },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Activity description {index + 1}
                      <textarea
                        value={item.description}
                        maxLength={500}
                        onChange={(e) => {
                          const items = [...body.rundown!.items];
                          items[index] = {
                            ...item,
                            description: e.target.value,
                          };
                          change({
                            ...body,
                            rundown: { ...body.rundown!, items },
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        change({
                          ...body,
                          rundown: {
                            ...body.rundown!,
                            items: body.rundown!.items.filter(
                              (_, i) => i !== index,
                            ),
                          },
                        })
                      }
                    >
                      Remove activity {index + 1}
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={body.rundown.items.length >= 30}
                  onClick={() =>
                    change({
                      ...body,
                      rundown: {
                        ...body.rundown!,
                        items: [
                          ...body.rundown!.items,
                          { startsAt: "", title: "", description: "" },
                        ],
                      },
                    })
                  }
                >
                  Add activity
                </button>
              </>
            ) : null}
          </fieldset>
          <div className="form-actions">
            <button
              type="button"
              disabled={disabled || !dirty}
              onClick={() =>
                void mutate(
                  () =>
                    api.save(snapshot.eventId, snapshot.version, body, csrf),
                  "save",
                )
              }
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPreview("draft")}
            >
              Preview draft
            </button>
            <button
              type="button"
              disabled={disabled || !snapshot.published}
              onClick={() => setPreview("published")}
            >
              Preview published
            </button>
            <button
              type="button"
              disabled={disabled || dirty}
              onClick={() => setConfirm("publish")}
            >
              Publish saved draft
            </button>
            <button
              type="button"
              disabled={disabled || dirty || !snapshot.published}
              onClick={() => setConfirm("hide")}
            >
              Hide published content
            </button>
          </div>
          <fieldset disabled={disabled}>
            <legend>Supporting files</legend>
            <p>
              PNG, JPEG, WebP or PDF; up to 5 MiB each, 8 files per event.
              Images are normalized; PDFs download separately.
            </p>
            <label>
              Upload file
              <input
                ref={uploadInput}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              disabled={!file || snapshot.assets.length >= 8}
              onClick={() => {
                if (!file) return;
                if (
                  file.size > 5 * 1024 * 1024 ||
                  !/\.(png|jpe?g|webp|pdf)$/i.test(file.name)
                ) {
                  setTone("error");
                  setMessage("Choose a supported file up to 5 MiB.");
                  return;
                }
                void mutate(
                  () =>
                    api.upload(snapshot.eventId, snapshot.version, file, csrf),
                  "upload",
                );
              }}
            >
              Upload supporting file
            </button>
            <ul>
              {snapshot.assets.map((asset, index) => (
                <li key={asset.id}>
                  <a
                    href={`/api/admin/event-content/${snapshot.eventId}/assets/${asset.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open {asset.kind === "PDF" ? "PDF" : "image"} {index + 1}
                  </a>{" "}
                  · {Math.ceil(asset.byteSize / 1024)} KB ·{" "}
                  {asset.usedByDraft
                    ? "Used by saved draft"
                    : "Not used by saved draft"}
                  {asset.usedByPublished ? " · Used by published snapshot" : ""}
                  <button
                    type="button"
                    disabled={
                      dirty || asset.usedByDraft || asset.usedByPublished
                    }
                    onClick={() => setConfirm({ deleteId: asset.id })}
                  >
                    Delete file {index + 1}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
          {selectedPreview ? (
            <section aria-label="Material preview">
              <h2>
                {preview === "draft"
                  ? "Draft preview — not published"
                  : "Current published preview"}
              </h2>
              <p>
                Unfinished activities without a valid time are omitted from this
                preview. Publication still validates all fields.
              </p>
              <div className="venue-admin-preview public-invitation-surface">
                <VenueInformation
                  content={venueFromApi(
                    [
                      {
                        eventId: snapshot.eventId,
                        eventName: snapshot.eventName,
                        content: selectedPreview,
                      },
                    ],
                    (id, asset) =>
                      `/api/admin/event-content/${id}/assets/${asset}`,
                  )}
                />
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      {confirm ? (
        <dialog
          ref={dialog}
          onCancel={() => setConfirm(null)}
          role="alertdialog"
          aria-label="Confirm material action"
          aria-describedby="material-confirm-description"
        >
          <p id="material-confirm-description">
            {typeof confirm === "object" && confirm.deleteId === "reload"
              ? "Discard local edits and reload authoritative saved state? A previous uncertain request may still finish."
              : confirm === "publish"
                ? "Publish the saved draft for eligible guests?"
                : confirm === "hide"
                  ? "Hide current published content? Draft and files will remain."
                  : "Permanently delete this unused file?"}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                typeof confirm === "object" &&
                confirm.deleteId === "reload"
              ) {
                void load(eventId);
                return;
              }
              if (!snapshot) return;
              void mutate(() =>
                confirm === "publish"
                  ? api.publish(snapshot.eventId, snapshot.version, csrf)
                  : confirm === "hide"
                    ? api.hide(snapshot.eventId, snapshot.version, csrf)
                    : api.remove(
                        snapshot.eventId,
                        (confirm as { deleteId: string }).deleteId,
                        snapshot.version,
                        csrf,
                      ),
              );
            }}
          >
            Confirm action
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
        </dialog>
      ) : null}
    </section>
  );
}
function localTime(iso: string) {
  return toWibMinute(iso);
}
