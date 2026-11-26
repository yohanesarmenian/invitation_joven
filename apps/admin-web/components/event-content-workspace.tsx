"use client";
import { ActionFeedback, type FeedbackTone } from "./action-feedback";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
import * as api from "../src/event-content/client";
import { eventHref, replaceEventSelection } from "../src/events/selection";
import { useEditorNavigation } from "../src/events/use-editor-navigation";
import { VenueInformation } from "../../invitation-web/components/invitation/venue-information";
import { venueFromApi } from "../../invitation-web/src/content/venue-api";
import {
  readWibMinuteAtSave,
  wibMinuteTimestamp,
  type WibMinuteEdit,
} from "../src/forms/wib-date-time";
import { WibDateTimeField } from "./wib-date-time-field";

type Rundown = NonNullable<api.Body["rundown"]>;
type EditableItem = Rundown["items"][number] & { timeEdit?: WibMinuteEdit };
type DraftItem = EditableItem & { editorKey: number };
type Draft = Omit<api.Body, "rundown"> & {
  rundown: (Omit<Rundown, "items"> & { items: DraftItem[] }) | null;
};
const empty: Draft = { parking: null, rundown: null };
type Confirm = "publish" | "hide" | { deleteId: string } | null;

function serializeDraft({
  parking,
  rundown,
}: {
  parking: api.Body["parking"];
  rundown: { title: string; items: EditableItem[] } | null;
}): api.Body {
  return {
    parking,
    rundown: rundown && {
      title: rundown.title,
      items: rundown.items.map(
        ({ startsAt, title, description, timeEdit }) => ({
          startsAt: wibMinuteTimestamp(startsAt, timeEdit, ""),
          title,
          description,
        }),
      ),
    },
  };
}

export function EventContentWorkspace({
  csrfToken,
  initialSelection,
}: {
  csrfToken: string;
  initialSelection: string | null;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<AdminEventsResponse["events"]>([]);
  const [eventId, setEventId] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [retryTarget, setRetryTarget] = useState("");
  const [snapshot, setSnapshot] = useState<api.State | null>(null);
  const [body, setBody] = useState<Draft>(empty);
  const [csrf, setCsrf] = useState(csrfToken);
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("Loading events…"),
    [confirm, setConfirm] = useState<Confirm>(null);
  const [tone, setTone] = useState<FeedbackTone>("info");
  const [preview, setPreview] = useState<"draft" | "published" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const nextActivityKey = useRef(0);
  const rundownFields = useRef<HTMLFieldSetElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false),
    generation = useRef(0),
    stopped = useRef(false);
  const content = serializeDraft(body);
  const invalidTime = body.rundown?.items.find(
    (item) => item.timeEdit?.kind === "invalid",
  );
  const dirty =
    snapshot !== null &&
    (Boolean(invalidTime) ||
      JSON.stringify(content) !==
        JSON.stringify(serializeDraft(snapshot.draft)));

  function loadDraft(saved: api.Body) {
    const draft = structuredClone(saved);
    setBody({
      ...draft,
      rundown: draft.rundown && {
        ...draft.rundown,
        items: draft.rundown.items.map((item) => ({
          ...item,
          editorKey: nextActivityKey.current++,
        })),
      },
    });
  }

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
      setCatalog([]);
      setEventId("");
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
      if (!active || stopped.current) return;
      if (result.kind === "ok") {
        setCatalog(result.data.events);
        if (
          initialSelection &&
          result.data.events.some((event) => event.id === initialSelection)
        ) {
          void load(initialSelection);
        } else {
          setTone(initialSelection ? "error" : "info");
          setMessage(
            initialSelection
              ? "Requested event is invalid or no longer available. Choose an event to continue."
              : result.data.events.length
                ? "Choose an event to begin."
                : "No events yet. Configure a session in Events first.",
          );
        }
      } else {
        notice(result);
        if (result.kind !== "error" || result.code !== "UNAUTHENTICATED")
          setMessage("Unable to load events. Reload this page.");
      }
      setCatalogLoading(false);
    });
    const clear = () => {
      stopped.current = true;
      generation.current++;
      setSnapshot(null);
      setCatalog([]);
      setEventId("");
      setRetryTarget("");
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
    // This document owns its initial selection and its session-bound catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEditorNavigation(
    () => ({
      pending: !stopped.current && lock.current,
      blocked: !stopped.current && blocked,
      dirty: !stopped.current && hasDraft(),
    }),
    () => {
      setTone("warning");
      setMessage(
        "Finish the current action or reload saved state before leaving this editor.",
      );
    },
  );
  useEffect(() => {
    const node = dialog.current;
    if (confirm && node) {
      node.showModal();
      return () => node.close();
    }
  }, [confirm]);
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
        setRetryTarget("");
        replaceEventSelection("/event-content", target);
        setSnapshot(result.data);
        loadDraft(result.data.draft);
        setBlocked(false);
        setTone("info");
        setMessage("Saved state loaded.");
        setFile(null);
        if (uploadInput.current) uploadInput.current.value = "";
      } else {
        if (!snapshot) setRetryTarget(target);
        notice(
          result.kind === "ok"
            ? { kind: "error", code: "UNAVAILABLE" }
            : result,
        );
      }
    }
    lock.current = false;
    setBusy(false);
  }
  function activityTimeInput(editorKey: number) {
    return rundownFields.current?.querySelector<HTMLInputElement>(
      `#rundown-start-${editorKey}`,
    );
  }
  function readDraftTimes(): Draft {
    const { rundown } = body;
    if (!rundown) return body;
    const items = rundown.items.map((item) => {
      const timeEdit = readWibMinuteAtSave(
        activityTimeInput(item.editorKey),
        item.startsAt,
        item.timeEdit,
      );
      return timeEdit === item.timeEdit ? item : { ...item, timeEdit };
    });
    return items.every((item, index) => item === rundown.items[index])
      ? body
      : { ...body, rundown: { ...rundown, items } };
  }
  function hasDraft() {
    return (
      dirty || file !== null || (snapshot !== null && readDraftTimes() !== body)
    );
  }
  async function mutate(
    call: (currentContent: api.Body) => Promise<api.Result<api.State>>,
    mode: "save" | "upload" | "other" = "other",
  ) {
    if (lock.current || blocked || !snapshot || stopped.current) return;
    const currentDraft = readDraftTimes();
    if (currentDraft !== body) setBody(currentDraft);
    const invalid = currentDraft.rundown?.items.find(
      (item) => item.timeEdit?.kind === "invalid",
    );
    if (invalid) {
      setTone("error");
      setMessage("Review the highlighted activity times before saving.");
      setConfirm(null);
      activityTimeInput(invalid.editorKey)?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    setTone("info");
    setMessage("Updating event materials…");
    setConfirm(null);
    setPreview(null);
    const current = generation.current;
    const result = await call(serializeDraft(currentDraft));
    if (current === generation.current && !stopped.current) {
      if (
        result.kind === "ok" &&
        result.data.eventId === snapshot.eventId &&
        result.data.version === snapshot.version + 1
      ) {
        setSnapshot(result.data);
        if (mode === "save") loadDraft(result.data.draft);
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
  function change(next: Draft) {
    if (lock.current || blocked || stopped.current) return;
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
        ? content
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
        disabled={catalogLoading || busy || dirty || blocked || file !== null}
        onChange={(e) => {
          if (
            !hasDraft() &&
            !blocked &&
            e.target.value &&
            e.target.value !== eventId
          )
            void load(e.target.value);
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
      {eventId || retryTarget ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!hasDraft() && !blocked) void load(retryTarget || eventId);
            else setConfirm({ deleteId: "reload" });
          }}
        >
          Reload saved state
        </button>
      ) : null}
      {eventId && !disabled ? (
        <p>
          {catalog.find((event) => event.id === eventId)?.isActive === false
            ? "Inactive event. "
            : null}
          <a href={eventHref("/events", eventId)}>
            Back to event configuration
          </a>
        </p>
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
          <fieldset disabled={disabled} ref={rundownFields}>
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
                  <fieldset key={item.editorKey}>
                    <legend>Activity {index + 1}</legend>
                    <WibDateTimeField
                      id={`rundown-start-${item.editorKey}`}
                      label={`Start (WIB) ${index + 1}`}
                      clearLabel={`Clear activity ${index + 1} time`}
                      original={item.startsAt}
                      edit={item.timeEdit}
                      onEdit={(timeEdit) => {
                        const items = [...body.rundown!.items];
                        items[index] = { ...item, timeEdit };
                        change({
                          ...body,
                          rundown: { ...body.rundown!, items },
                        });
                      }}
                    />
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
                          {
                            startsAt: "",
                            title: "",
                            description: "",
                            editorKey: nextActivityKey.current++,
                          },
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
                  (currentContent) =>
                    api.save(
                      snapshot.eventId,
                      snapshot.version,
                      currentContent,
                      csrf,
                    ),
                  "save",
                )
              }
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={disabled || Boolean(invalidTime)}
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
                onChange={(e) => {
                  if (!lock.current && !blocked && !stopped.current)
                    setFile(e.target.files?.[0] ?? null);
                }}
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
                void load(retryTarget || eventId);
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
