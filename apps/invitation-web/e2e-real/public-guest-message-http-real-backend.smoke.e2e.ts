import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  readSmokeState,
  runFixtureCli,
  type SmokeMessageState,
} from "./smoke-fixture";

/**
 * Phase 7 real-backend guest message matrix, driven against the compiled Nest
 * API and the isolated real PostgreSQL smoke database.
 *
 * This file deliberately loads no browser pages: `open_count` is asserted as an
 * exact seeded-baseline delta by the Phase 4 retrieval smoke, so an extra page
 * load here would corrupt that assertion depending on file order. Every test
 * below is therefore safe to run in any order.
 *
 * Privacy: guest message content and `authorName` are user-authored personal
 * content. The synthetic constants below exist only in test source. They are
 * never printed, never used in a test title, and never interpolated into an
 * assertion message — failures are reported as booleans, and DB-side content
 * equality is proven by comparing SHA-256 digests rather than raw values.
 */

const REAL_API_BASE_URL = "http://127.0.0.1:4000";

const AUTHOR_WITH_PADDING = "  Smoke Author  ";
const AUTHOR_NORMALIZED = "Smoke Author";
const MESSAGE_WITH_PADDING = "  First line\nSecond line  ";
const MESSAGE_NORMALIZED = "First line\nSecond line";
const SCRIPT_MESSAGE = "<script>window.__xss = 1</script> plain text";
const EMOJI = "😀";

function messageState(): SmokeMessageState {
  return runFixtureCli<SmokeMessageState>("message-state");
}

function resetMessages(): void {
  runFixtureCli<{ status: string }>("reset-messages");
}

function setInvitationStatus(status: "active" | "archived"): void {
  runFixtureCli<{ status: string }>("set-invitation-status", [status]);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Code points, not UTF-16 units: the contract caps on code points. */
function codePoints(value: string): number {
  return [...value].length;
}

type ApiResult = {
  body: Record<string, unknown>;
  status: number;
  text: string;
};

async function postGuestMessage(
  publicCredential: string,
  body: unknown,
): Promise<ApiResult> {
  const response = await fetch(
    `${REAL_API_BASE_URL}/api/public/invitations/${publicCredential}/messages`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const text = await response.text();

  return {
    body: JSON.parse(text) as Record<string, unknown>,
    status: response.status,
    text,
  };
}

async function fetchRsvp(publicCredential: string): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${REAL_API_BASE_URL}/api/public/invitations/${publicCredential}/rsvp`,
  );

  expect(response.status).toBe(200);

  return (await response.json()) as Record<string, unknown>;
}

async function putRsvp(
  publicCredential: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${REAL_API_BASE_URL}/api/public/invitations/${publicCredential}/rsvp`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PUT",
    },
  );

  expect(response.status).toBe(200);

  return (await response.json()) as Record<string, unknown>;
}

function errorCode(result: ApiResult): unknown {
  const error = result.body.error;

  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>).code
    : null;
}

/** Field-aware assertion that the response is exactly the locked public shape. */
function expectMinimalResponse(result: ApiResult): void {
  expect(result.status).toBe(201);
  expect(Object.keys(result.body)).toEqual(["message"]);

  const message = result.body.message as Record<string, unknown>;

  expect(Object.keys(message)).toEqual(["createdAt"]);
  expect(typeof message.createdAt).toBe("string");
  expect(Number.isNaN(Date.parse(message.createdAt as string))).toBe(false);

  // The whole body is this one object, so substring checks are meaningful here:
  // no echoed guest content, no identifier of any kind.
  expect(result.text.includes(MESSAGE_NORMALIZED)).toBe(false);
  expect(result.text.includes(AUTHOR_NORMALIZED)).toBe(false);
  expect(result.text.toLowerCase().includes("id")).toBe(false);
  expect(result.text.includes("isHidden")).toBe(false);
}

test("real api: a named message is normalized, persisted, and answered with createdAt only", async () => {
  const state = readSmokeState();

  resetMessages();

  const result = await postGuestMessage(state.publicCredential, {
    authorName: AUTHOR_WITH_PADDING,
    message: MESSAGE_WITH_PADDING,
  });

  expectMinimalResponse(result);

  const after = messageState();

  expect(after.messageCount).toBe(1);

  const [row] = after.messages;

  expect(row).toBeDefined();
  expect(row!.invitationIdMatches).toBe(true);
  expect(row!.isHidden).toBe(false);
  expect(Number.isNaN(Date.parse(row!.createdAtIso))).toBe(false);
  expect(row!.authorNamePresent).toBe(true);
  expect(row!.authorNameIsTrimmed).toBe(true);
  expect(row!.messageIsTrimmed).toBe(true);
  expect(row!.messageHasNewline).toBe(true);
  expect(row!.authorNameCodePoints).toBe(codePoints(AUTHOR_NORMALIZED));
  expect(row!.messageCodePoints).toBe(codePoints(MESSAGE_NORMALIZED));
  // Exact content, proven without exposing it.
  expect(row!.authorNameSha256).toBe(sha256(AUTHOR_NORMALIZED));
  expect(row!.messageSha256).toBe(sha256(MESSAGE_NORMALIZED));

  resetMessages();
});

test("real api: omitted and blank author names both persist as null", async () => {
  const state = readSmokeState();

  resetMessages();

  const anonymous = await postGuestMessage(state.publicCredential, {
    message: MESSAGE_NORMALIZED,
  });

  expectMinimalResponse(anonymous);

  const blank = await postGuestMessage(state.publicCredential, {
    authorName: "   ",
    message: MESSAGE_NORMALIZED,
  });

  expectMinimalResponse(blank);

  const after = messageState();

  expect(after.messageCount).toBe(2);

  for (const row of after.messages) {
    expect(row.authorNamePresent).toBe(false);
    expect(row.authorNameSha256).toBe(null);
  }

  resetMessages();
});

test("real api: rejected content writes no rows", async () => {
  const state = readSmokeState();

  resetMessages();

  const rejected = [
    { message: "" },
    { message: "   " },
    { message: "\n\n" },
    { authorName: AUTHOR_NORMALIZED },
    { authorName: null, message: 42 },
    { authorName: AUTHOR_NORMALIZED, message: null },
  ];

  for (const body of rejected) {
    const result = await postGuestMessage(state.publicCredential, body);

    expect(result.status).toBe(400);
    expect(errorCode(result)).toBe("VALIDATION_ERROR");
    expect(result.text.includes(MESSAGE_NORMALIZED)).toBe(false);
  }

  // Unknown top-level fields are rejected rather than ignored.
  const unknownField = await postGuestMessage(state.publicCredential, {
    invitationId: state.invitationId,
    message: MESSAGE_NORMALIZED,
  });

  expect(unknownField.status).toBe(400);
  expect(errorCode(unknownField)).toBe("VALIDATION_ERROR");

  expect(messageState().messageCount).toBe(0);
});

test("real api: Unicode caps are enforced at 1000 message and 100 author code points", async () => {
  const state = readSmokeState();

  resetMessages();

  const atMessageCap = EMOJI.repeat(1000);
  const overMessageCap = EMOJI.repeat(1001);
  const atAuthorCap = EMOJI.repeat(100);
  const overAuthorCap = EMOJI.repeat(101);

  const accepted = await postGuestMessage(state.publicCredential, {
    authorName: atAuthorCap,
    message: atMessageCap,
  });

  expectMinimalResponse(accepted);

  const afterAccept = messageState();
  const [row] = afterAccept.messages;

  // Surrogate pairs counted as one code point each: the cap is not UTF-16 length.
  expect(row!.messageCodePoints).toBe(1000);
  expect(row!.authorNameCodePoints).toBe(100);
  // Not truncated by the column or the insert.
  expect(row!.messageSha256).toBe(sha256(atMessageCap));
  expect(row!.authorNameSha256).toBe(sha256(atAuthorCap));

  const overMessage = await postGuestMessage(state.publicCredential, {
    message: overMessageCap,
  });

  expect(overMessage.status).toBe(400);
  expect(errorCode(overMessage)).toBe("VALIDATION_ERROR");

  const overAuthor = await postGuestMessage(state.publicCredential, {
    authorName: overAuthorCap,
    message: MESSAGE_NORMALIZED,
  });

  expect(overAuthor.status).toBe(400);
  expect(errorCode(overAuthor)).toBe("VALIDATION_ERROR");

  expect(messageState().messageCount).toBe(1);

  resetMessages();
});

test("real api: script-like content is stored as plain text and never echoed", async () => {
  const state = readSmokeState();

  resetMessages();

  const result = await postGuestMessage(state.publicCredential, {
    message: SCRIPT_MESSAGE,
  });

  expectMinimalResponse(result);
  expect(result.text.includes("script")).toBe(false);

  const after = messageState();
  const [row] = after.messages;

  // Persisted verbatim: the API does not sanitize, it never interprets.
  expect(row!.messageSha256).toBe(sha256(SCRIPT_MESSAGE));

  resetMessages();
});

test("real api: unknown and archived invitations share one generic 404 and write no rows", async () => {
  const state = readSmokeState();

  resetMessages();

  const unknown = await postGuestMessage("Z".repeat(43), {
    message: MESSAGE_NORMALIZED,
  });

  expect(unknown.status).toBe(404);
  expect(errorCode(unknown)).toBe("INVITATION_NOT_AVAILABLE");

  try {
    setInvitationStatus("archived");

    const archived = await postGuestMessage(state.publicCredential, {
      message: MESSAGE_NORMALIZED,
    });

    expect(archived.status).toBe(404);
    expect(errorCode(archived)).toBe("INVITATION_NOT_AVAILABLE");
    // Identical envelope: an archived link is indistinguishable from a bad one.
    // Only the per-request correlation fields may differ.
    expect(archived.body.error).toEqual(unknown.body.error);

    // The archived invitation is also unavailable to the public read path.
    const read = await fetch(
      `${REAL_API_BASE_URL}/api/public/invitations/${state.publicCredential}`,
    );

    expect(read.status).toBe(404);
  } finally {
    setInvitationStatus("active");
  }

  expect(messageState().messageCount).toBe(0);

  // Restored: the same credential accepts again.
  const restored = await postGuestMessage(state.publicCredential, {
    message: MESSAGE_NORMALIZED,
  });

  expectMinimalResponse(restored);

  resetMessages();
});

test("real api: availability ignores RSVP state, RSVP version, and the RSVP deadline", async () => {
  const state = readSmokeState();
  // The ids come from the fixture handoff, not the public `GET`: that read bumps
  // `open_count` and would break the Phase 4 retrieval smoke's exact delta.
  const eventId = state.eventId;
  const inviteeId = state.inviteeId;

  runFixtureCli<{ status: string }>("reset-rsvp");
  resetMessages();

  // No RSVP at all.
  const withoutRsvp = await postGuestMessage(state.publicCredential, {
    message: MESSAGE_NORMALIZED,
  });

  expectMinimalResponse(withoutRsvp);

  // Accepted RSVP with an active check-in pass.
  const accepted = await putRsvp(state.publicCredential, {
    attendees: [{ inviteeId, quantity: 1, type: "NAMED_INVITEE" }],
    dietaryNotes: "Smoke smoke-free household",
    eventSelections: [
      { attending: true, eventId, expectedAttendeeCount: 1 },
    ],
    expectedVersion: null,
    status: "ACCEPTED",
  });
  const acceptedRsvp = accepted.rsvp as Record<string, unknown>;
  const acceptedPass = accepted.checkinPass as Record<string, unknown>;

  expect(acceptedRsvp.status).toBe("ACCEPTED");
  expect(acceptedRsvp.version).toBe(1);
  expect(acceptedPass.status).toBe("ACTIVE");

  const afterAccept = await postGuestMessage(state.publicCredential, {
    message: MESSAGE_NORMALIZED,
  });

  expectMinimalResponse(afterAccept);

  const canonicalAfterAccept = await fetchRsvp(state.publicCredential);
  const passAfterAccept = canonicalAfterAccept.checkinPass as Record<
    string,
    unknown
  >;

  // The RSVP and its pass are untouched by the message write.
  expect(canonicalAfterAccept.rsvp).toEqual(accepted.rsvp);
  expect(passAfterAccept.qrPayload).toBe(acceptedPass.qrPayload);
  expect(passAfterAccept.issuedAt).toBe(acceptedPass.issuedAt);

  // Declined RSVP: the message path stays open and the RSVP stays declined.
  const declined = await putRsvp(state.publicCredential, {
    attendees: [],
    dietaryNotes: null,
    eventSelections: [],
    expectedVersion: 1,
    status: "DECLINED",
  });

  expect((declined.rsvp as Record<string, unknown>).status).toBe("DECLINED");
  expect(declined.checkinPass).toBe(null);

  const afterDecline = await postGuestMessage(state.publicCredential, {
    message: MESSAGE_NORMALIZED,
  });

  expectMinimalResponse(afterDecline);

  const canonicalAfterDecline = await fetchRsvp(state.publicCredential);

  expect(canonicalAfterDecline.rsvp).toEqual(declined.rsvp);
  expect(canonicalAfterDecline.checkinPass).toBe(null);

  // Past RSVP deadline while the invitation stays ACTIVE: RSVP mutation closes,
  // guest messages do not.
  runFixtureCli<{ status: string }>("set-deadline", ["past"]);

  try {
    const closedResponse = await fetch(
      `${REAL_API_BASE_URL}/api/public/invitations/${state.publicCredential}/rsvp`,
      {
        body: JSON.stringify({
          attendees: [],
          dietaryNotes: null,
          eventSelections: [],
          expectedVersion: 2,
          status: "ACCEPTED",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    );
    const closedBody = (await closedResponse.json()) as Record<
      string,
      unknown
    >;

    // The RSVP cutoff still closes RSVP mutation...
    expect(closedResponse.status).toBe(422);
    expect(
      (closedBody.error as Record<string, unknown>).code,
    ).toBe("RSVP_DEADLINE_PASSED");

    const afterDeadline = await postGuestMessage(state.publicCredential, {
      message: MESSAGE_NORMALIZED,
    });

    expectMinimalResponse(afterDeadline);
  } finally {
    runFixtureCli<{ status: string }>("set-deadline", ["none"]);
  }

  // Four explicit submissions above: four separate rows, no deduplication.
  expect(messageState().messageCount).toBe(4);

  resetMessages();
  runFixtureCli<{ status: string }>("reset-rsvp");
});

test("real api: every explicit submission appends a new row and ownership follows the credential", async () => {
  const state = readSmokeState();

  resetMessages();

  const first = await postGuestMessage(state.publicCredential, {
    message: MESSAGE_NORMALIZED,
  });
  const second = await postGuestMessage(state.publicCredential, {
    message: MESSAGE_NORMALIZED,
  });

  expectMinimalResponse(first);
  expectMinimalResponse(second);

  const after = messageState();

  expect(after.messageCount).toBe(2);
  expect(after.messages[0]!.id).not.toBe(after.messages[1]!.id);

  for (const row of after.messages) {
    expect(row.invitationIdMatches).toBe(true);
    expect(row.messageSha256).toBe(sha256(MESSAGE_NORMALIZED));
  }

  // A request body cannot redirect ownership: the field is rejected outright.
  const redirect = await postGuestMessage(state.publicCredential, {
    invitationId: state.invitationId,
    message: MESSAGE_NORMALIZED,
  });

  expect(redirect.status).toBe(400);
  expect(messageState().messageCount).toBe(2);

  resetMessages();
  expect(messageState().messageCount).toBe(0);
});
