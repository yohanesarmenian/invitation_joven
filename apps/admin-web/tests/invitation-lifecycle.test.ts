import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  archiveInvitation,
  createInvitee,
  deleteInvitee,
  loadPublicUrl,
  regenerateInvitationToken,
  replaceInvitationEvents,
  updateInvitee,
  updateInvitation,
} from "../src/invitations/lifecycle";
import { auth, failure, json } from "./fixtures";
import { detail, events } from "./invitation-fixtures";

const NativeRequest = Request;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === "string"
            ? new URL(input, "http://localhost:3001")
            : input,
          init,
        );
      }
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it("sends exact PATCH payload with loaded expectedUpdatedAt and no retry", async () => {
  const body = {
    expectedUpdatedAt: detail.invitation.updatedAt,
    displayName: "Edited household",
    greetingName: null,
    allowPlusOne: true,
    maxAdditionalChildren: 2,
    rsvpDeadlineAt: null,
    notes: "note",
  };
  fetchMock.mockResolvedValue(json(detail));
  expect(
    await updateInvitation(detail.invitation.id, body, "csrf-token"),
  ).toMatchObject({ kind: "updated" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("PATCH");
  expect(req.url).toBe(
    `http://localhost:3001/api/admin/invitations/${detail.invitation.id}`,
  );
  expect(req.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(req.headers.has("idempotency-key")).toBe(false);
  expect(await req.json()).toEqual(body);
});

it("preserves conflict and validation as explicit human states", async () => {
  fetchMock.mockResolvedValueOnce(failure("CONFLICT", 409));
  expect(
    await updateInvitation(
      detail.invitation.id,
      { expectedUpdatedAt: detail.invitation.updatedAt },
      "csrf",
    ),
  ).toEqual({ kind: "conflict" });
  fetchMock.mockResolvedValueOnce(failure("VALIDATION_ERROR", 400));
  expect(
    await updateInvitation(
      detail.invitation.id,
      { expectedUpdatedAt: detail.invitation.updatedAt },
      "csrf",
    ),
  ).toEqual({ kind: "validation" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("CSRF refresh never replays PATCH", async () => {
  fetchMock
    .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
    .mockResolvedValueOnce(json(auth));
  expect(
    await updateInvitation(
      detail.invitation.id,
      { expectedUpdatedAt: detail.invitation.updatedAt },
      "old",
    ),
  ).toMatchObject({ kind: "csrf", csrfToken: auth.csrfToken });
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "PATCH",
    "GET",
  ]);
});

it("archives with no request body and explicit confirmation caller", async () => {
  fetchMock.mockResolvedValue(
    json({
      invitation: {
        id: detail.invitation.id,
        status: "ARCHIVED",
        archivedAt: "2026-10-01T18:00:00.000Z",
      },
    }),
  );
  expect(await archiveInvitation(detail.invitation.id, "csrf")).toMatchObject({
    kind: "archived",
  });
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("POST");
  expect(req.url).toBe(
    `http://localhost:3001/api/admin/invitations/${detail.invitation.id}/archive`,
  );
  expect(await req.text()).toBe("");
});

it("loads public URL with safe GET only", async () => {
  fetchMock.mockResolvedValue(
    json({
      publicTokenVersion: 3,
      publicUrl: "http://localhost:3000/i/current",
    }),
  );
  expect(await loadPublicUrl(detail.invitation.id)).toEqual({
    kind: "loaded",
    data: {
      publicTokenVersion: 3,
      publicUrl: "http://localhost:3000/i/current",
    },
  });
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("GET");
  expect(req.headers.has("x-csrf-token")).toBe(false);
});

it("regeneration sends one expectedTokenVersion and never retries uncertain outcomes", async () => {
  fetchMock.mockRejectedValueOnce(new Error("connection reset"));
  expect(
    await regenerateInvitationToken(detail.invitation.id, 1, "csrf"),
  ).toEqual({ kind: "uncertain" });
  fetchMock.mockResolvedValueOnce(json({}, 200));
  expect(
    await regenerateInvitationToken(detail.invitation.id, 1, "csrf"),
  ).toEqual({ kind: "uncertain" });
  fetchMock.mockResolvedValueOnce(failure("INTERNAL_ERROR", 500));
  expect(
    await regenerateInvitationToken(detail.invitation.id, 1, "csrf"),
  ).toEqual({ kind: "uncertain" });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  for (const call of fetchMock.mock.calls) {
    expect(call[0].method).toBe("POST");
  }
});

it("regeneration conflict is not retried and recovery remains a GET", async () => {
  fetchMock
    .mockResolvedValueOnce(failure("CONFLICT", 409))
    .mockResolvedValueOnce(
      json({
        publicTokenVersion: 2,
        publicUrl: "http://localhost:3000/i/recovered",
      }),
    );
  expect(
    await regenerateInvitationToken(detail.invitation.id, 1, "csrf"),
  ).toEqual({ kind: "conflict" });
  expect(await loadPublicUrl(detail.invitation.id)).toMatchObject({
    kind: "loaded",
  });
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "POST",
    "GET",
  ]);
});

it("creates invitee with exact body and never adds idempotency headers", async () => {
  const body = {
    fullName: "Duplicate guest",
    category: "ADULT" as const,
    label: null,
  };
  fetchMock.mockResolvedValue(
    json(
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        invitationId: detail.invitation.id,
        fullName: body.fullName,
        category: body.category,
        label: body.label,
        displayOrder: 3,
        createdAt: "2026-10-01T00:00:03.000Z",
        updatedAt: "2026-10-01T00:00:03.000Z",
      },
      201,
    ),
  );
  expect(
    await createInvitee(detail.invitation.id, body, "csrf-token"),
  ).toMatchObject({ kind: "created" });
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("POST");
  expect(req.url).toBe(
    `http://localhost:3001/api/admin/invitations/${detail.invitation.id}/invitees`,
  );
  expect(req.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(req.headers.has("idempotency-key")).toBe(false);
  expect(await req.json()).toEqual(body);
});

it("CSRF refresh never replays invitee create", async () => {
  fetchMock
    .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
    .mockResolvedValueOnce(json(auth));
  expect(
    await createInvitee(
      detail.invitation.id,
      { fullName: "Fresh guest", category: "ADULT", label: null },
      "old",
    ),
  ).toMatchObject({ kind: "csrf", csrfToken: auth.csrfToken });
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "POST",
    "GET",
  ]);
});

it("updates invitee with loaded invitee updatedAt and preserves conflict", async () => {
  const invitee = detail.invitation.invitees[0]!;
  const body = {
    expectedUpdatedAt: invitee.updatedAt,
    fullName: "Edited guest",
    category: "CHILD" as const,
    label: "Child",
  };
  fetchMock.mockResolvedValueOnce(failure("CONFLICT", 409));
  expect(await updateInvitee(invitee.id, body, "csrf-token")).toEqual({
    kind: "conflict",
  });
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("PATCH");
  expect(req.url).toBe(
    `http://localhost:3001/api/admin/invitees/${invitee.id}`,
  );
  expect(req.headers.has("idempotency-key")).toBe(false);
  expect(await req.json()).toEqual(body);
});

it("deletes invitee with explicit DELETE and maps reference conflicts", async () => {
  const invitee = detail.invitation.invitees[0]!;
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(await deleteInvitee(invitee.id, "csrf-token")).toEqual({
    kind: "deleted",
  });
  fetchMock.mockResolvedValueOnce(failure("CONFLICT", 409));
  expect(await deleteInvitee(invitee.id, "csrf-token")).toEqual({
    kind: "conflict",
  });
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "DELETE",
    "DELETE",
  ]);
});

it("replaces event eligibility with complete selected eventIds", async () => {
  const body = { eventIds: [events[0]!.id, events[2]!.id] };
  fetchMock.mockResolvedValue(
    json({
      eligibility: body.eventIds.map((eventId) => ({
        event: events.find((event) => event.id === eventId)!,
      })),
    }),
  );
  expect(
    await replaceInvitationEvents(detail.invitation.id, body, "csrf-token"),
  ).toMatchObject({ kind: "updated" });
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("PUT");
  expect(req.url).toBe(
    `http://localhost:3001/api/admin/invitations/${detail.invitation.id}/events`,
  );
  expect(req.headers.has("idempotency-key")).toBe(false);
  expect(await req.json()).toEqual(body);
});
