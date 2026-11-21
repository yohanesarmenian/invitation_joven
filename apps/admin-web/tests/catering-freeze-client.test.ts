import { beforeEach, describe, expect, it, vi } from "vitest";
import { freezeCatering, type FreezeCatering } from "../src/reports/client";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@wedding-invitation/api-client/src/index", () => ({
  createInvitationApiClient: () => ({ POST: post }),
}));

const request: FreezeCatering = {
  operationId: "00000000-0000-4000-8000-000000000001",
  expectedVersion: 0,
  eventId: null,
  includeArchived: false,
};
const receipt = {
  version: 1,
  capturedAt: "2026-01-02T00:00:00.000Z",
  capturedById: "00000000-0000-4000-8000-000000000002",
  schemaVersion: 1,
  eventId: null,
  includeArchived: false,
};

function respond(status: number, code: string, details?: object) {
  post.mockResolvedValue({
    response: new Response(null, { status }),
    error: { error: { code, details } },
  });
}

describe("freeze response classification", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("accepts the canonical receipt for the requested version and scope", async () => {
    post.mockResolvedValue({
      response: new Response(null, { status: 201 }),
      data: receipt,
    });
    await expect(freezeCatering(request, "test-csrf")).resolves.toEqual({
      kind: "ok",
      data: receipt,
    });
    expect(post).toHaveBeenCalledWith(
      "/api/admin/reports/catering/snapshots",
      expect.objectContaining({
        body: request,
        headers: { "X-CSRF-Token": "test-csrf" },
      }),
    );
  });

  it.each([
    undefined,
    { ...receipt, version: 2 },
    { ...receipt, includeArchived: true },
  ])(
    "keeps an invalid or mismatched success receipt uncertain (%j)",
    async (data) => {
      post.mockResolvedValue({
        response: new Response(null, { status: 200 }),
        data,
      });
      await expect(freezeCatering(request, "test-csrf")).resolves.toEqual({
        kind: "uncertain",
      });
    },
  );

  it("keeps transport failure uncertain", async () => {
    post.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(freezeCatering(request, "test-csrf")).resolves.toEqual({
      kind: "uncertain",
    });
  });

  it.each([
    [503, "INTERNAL_SERVER_ERROR"],
    [500, "VALIDATION_ERROR"],
    [409, "CONFLICT"],
    [400, "UNEXPECTED_ERROR"],
  ])(
    "keeps unsupported HTTP %s / %s evidence uncertain",
    async (status, code) => {
      respond(status, code);
      await expect(freezeCatering(request, "test-csrf")).resolves.toEqual({
        kind: "uncertain",
      });
    },
  );

  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [403, "CSRF_INVALID"],
  ])(
    "recognizes the pre-commit rejection HTTP %s / %s",
    async (status, code) => {
      respond(status, code);
      await expect(freezeCatering(request, "test-csrf")).resolves.toEqual({
        kind: "rejected",
      });
    },
  );

  it("requires proof of a newer version before resolving a conflict", async () => {
    respond(409, "CATERING_SNAPSHOT_VERSION_CONFLICT", { latestVersion: 0 });
    await expect(freezeCatering(request, "test-csrf")).resolves.toEqual({
      kind: "uncertain",
    });
    respond(409, "CATERING_SNAPSHOT_VERSION_CONFLICT", { latestVersion: 1 });
    await expect(freezeCatering(request, "test-csrf")).resolves.toEqual({
      kind: "version-conflict",
      latestVersion: 1,
    });
  });
});
