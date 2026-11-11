import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { typographyFixtures } from "./typography-fixtures";
import type {
  PublicInvitationResponse,
  PublicRsvpReadResponse,
  SubmitPublicRsvpRequest,
  SubmitPublicGuestMessageRequest,
} from "../../../packages/api-client/src/index";

// Test-only harness. Not production API configuration: the real API uses port
// 4000 and is never started by this suite.
const MOCK_HOST = "127.0.0.1";
const MOCK_PORT = Number(process.env.INVITATION_MOCK_API_PORT ?? 4010);
const PUBLIC_INVITATION_PATH_PREFIX = "/api/public/invitations/";

// Test-only credentials. Not secrets, not derived from CREDENTIAL_SECRET.
// The per-mode credential selects the mock response; everything else succeeds.
export const TEST_PUBLIC_CREDENTIAL = "A".repeat(43);
export const TEST_UNAVAILABLE_CREDENTIAL = "B".repeat(43);
export const TEST_MALFORMED_CREDENTIAL = "C".repeat(43);

const publicInvitationFixture: PublicInvitationResponse = {
  invitation: {
    displayName: "Test Household",
    greetingName: "Test Guest",
    // 4B2-A development baseline: the owner-approved temporary deadline.
    rsvpDeadlineAt: "2026-12-25T00:00:00.000Z",
    events: [
      {
        id: "event-test-1",
        slug: "holy-matrimony-test",
        name: "Holy Matrimony Test",
        endsAt: null,
        startsAt: "2027-01-09T01:00:00.000Z",
        venueName: "Test Church",
        address: "1 Test Street",
        googleMapsUrl: "https://maps.example.test/church",
      },
      {
        id: "event-test-2",
        slug: "reception-test",
        name: "Reception Test",
        endsAt: null,
        startsAt: "2027-01-09T05:00:00.000Z",
        venueName: "Test Ballroom",
        address: "2 Test Avenue",
        googleMapsUrl: "https://maps.example.test/reception",
      },
    ],
    invitees: [
      {
        id: "invitee-test-1",
        fullName: "Test Guest",
        category: "ADULT",
      },
    ],
    rules: {
      allowPlusOne: true,
      maxAdditionalChildren: 0,
    },
    rsvp: null,
  },
};

// Explicit local owner preview only. Regression suites keep their deterministic
// test names/URLs. These Figma details are not persisted or published to the API.
if (process.env.INVITATION_MOCK_PRESENTATION === "figma") {
  Object.assign(publicInvitationFixture.invitation, {
    displayName: "Jo & Venta local preview",
    greetingName: "Family & Friends",
    rsvpDeadlineAt: "2026-12-25T16:59:59.000Z",
    rules: { allowPlusOne: true, maxAdditionalChildren: 2 },
    invitees: [
      { id: "invitee-test-1", fullName: "Invited Guest", category: "ADULT" },
    ],
  });
  Object.assign(publicInvitationFixture.invitation.events[0]!, {
    name: "Holy Matrimony",
    venueName: "Gereja Katolik Paroki Santo Paulus, Depok",
    address: "Jl. Melati No.4, Depok, Kota Depok, Jawa Barat",
    googleMapsUrl: "https://maps.app.goo.gl/WuDNWnbfAvYZRmZU9",
  });
  Object.assign(publicInvitationFixture.invitation.events[1]!, {
    name: "Wedding Reception",
    venueName: "The Margo Hotel Ballroom",
    address: "Jl. Margonda No.358, Kota Depok, Jawa Barat",
    googleMapsUrl: "https://maps.app.goo.gl/rTYGg9rKUUkKBo8HA",
  });
}

// Mirrors the real public error envelope for an unavailable invitation. Carries
// no credential, no archive/expiry reason, and no invitation data.
const unavailableEnvelope = {
  error: {
    code: "INVITATION_NOT_AVAILABLE",
    message: "Resource not found",
    details: null,
  },
  requestId: "mock-request-id",
  timestamp: "2027-01-01T00:00:00.000Z",
};

// Structurally plausible but contract-violating: `events` must be an array, so
// the 5A runtime guard rejects this 200 and the error boundary must render.
const malformedInvitationFixture = {
  invitation: {
    ...publicInvitationFixture.invitation,
    events: "not-an-array",
  },
};

// Counts public invitation retrievals only; control endpoints never increment.
let publicInvitationRequestCount = 0;
let rsvpState: PublicRsvpReadResponse["rsvp"] = null;
let editBlockedReason: PublicRsvpReadResponse["editBlockedReason"] = null;
let checkinPass: PublicRsvpReadResponse["checkinPass"] = null;
let passSequence = 0;
function syncPass() {
  if (rsvpState?.status !== "ACCEPTED") checkinPass = null;
  else if (!checkinPass) {
    passSequence += 1;
    checkinPass = {
      status: "ACTIVE",
      issuedAt: "2026-09-30T00:00:00Z",
      // Deliberately synthetic, local-only test credentials.
      qrPayload: `fixture-pass-${passSequence}-`.padEnd(43, "x"),
    };
  }
}
let rsvpRequests: SubmitPublicRsvpRequest[] = [];
let rsvpRules = publicInvitationFixture.invitation.rules;
let rsvpDelayMs = 0;
let rsvpFailure: {
  status: number;
  code: string;
  method: "GET" | "PUT";
} | null = null;
let nextRsvpVersion: number | null = null;
let rsvpReadCount = 0;
let dropRsvpResponse = false;
let rsvpDeadlineAt = publicInvitationFixture.invitation.rsvpDeadlineAt;
let messageRequests: SubmitPublicGuestMessageRequest[] = [];
let messageCommits = 0;
let messageFixture: {
  delayMs?: number;
  failure?: { status: number; code: string };
  dropResponse?: boolean;
  malformed?: boolean;
} = {};

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", `http://${MOCK_HOST}`);

  if (request.method === "GET" && pathname === "/__health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (request.method === "GET" && pathname === "/__count") {
    sendJson(response, 200, { count: publicInvitationRequestCount });
    return;
  }

  if (request.method === "POST" && pathname === "/__reset") {
    publicInvitationRequestCount = 0;
    messageRequests = [];
    messageCommits = 0;
    messageFixture = {};
    rsvpState = null;
    editBlockedReason = null;
    checkinPass = null;
    passSequence = 0;
    rsvpRequests = [];
    rsvpRules = publicInvitationFixture.invitation.rules;
    rsvpDelayMs = 0;
    rsvpFailure = null;
    nextRsvpVersion = null;
    rsvpReadCount = 0;
    dropRsvpResponse = false;
    rsvpDeadlineAt = publicInvitationFixture.invitation.rsvpDeadlineAt;
    response.writeHead(204);
    response.end();
    return;
  }

  // Test-only RSVP controls; never part of the application or real backend.
  if (request.method === "POST" && pathname === "/__message-fixture") {
    let json = "";
    for await (const chunk of request) json += String(chunk);
    messageFixture = JSON.parse(json);
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && pathname === "/__message-state") {
    // Test harness inspection only; there is no public message read endpoint.
    sendJson(response, 200, {
      requests: messageRequests,
      commits: messageCommits,
    });
    return;
  }
  if (
    request.method === "GET" &&
    /^\/api\/public\/invitations\/[^/]+\/venue-content$/.test(pathname)
  ) {
    const directory = process.env.VENUE_CONTENT_DIRECTORY;
    const items: unknown[] = [];
    if (directory && pathname.includes("V".repeat(43))) {
      const parking = JSON.parse(
        readFileSync(resolve(directory, "parking.json"), "utf8"),
      );
      const rundown = JSON.parse(
        readFileSync(resolve(directory, "rundown.json"), "utf8"),
      );
      const eventId = "22222222-2222-4222-8222-222222222222";
      const guide = parking.guides.find(
        (guide: { eventId: string }) => guide.eventId === eventId,
      );
      const schedule = rundown.schedules.find(
        (schedule: { eventId: string }) => schedule.eventId === eventId,
      );
      items.push({
        eventId,
        eventName: "Reception Test",
        content: {
          parking:
            parking.status === "published" && guide
              ? {
                  title: guide.title,
                  instructions: guide.instructions,
                  mapAssetId: null,
                  mapAlt: "",
                  pdfAssetId: null,
                  googleMapsUrl: guide.googleMapsUrl,
                }
              : null,
          rundown:
            rundown.status === "published" && schedule
              ? { title: schedule.title, items: schedule.items }
              : null,
        },
      });
    }
    sendJson(response, 200, { items });
    return;
  }

  if (
    pathname.startsWith(PUBLIC_INVITATION_PATH_PREFIX) &&
    pathname.endsWith("/messages")
  ) {
    if (request.method !== "POST") {
      sendJson(response, 404, unavailableEnvelope);
      return;
    }
    let json = "";
    for await (const chunk of request) json += String(chunk);
    const body = JSON.parse(json) as SubmitPublicGuestMessageRequest;
    messageRequests.push(body);
    const fixture = messageFixture;
    if (fixture.delayMs)
      await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
    if (fixture.failure) {
      sendJson(response, fixture.failure.status, {
        error: {
          code: fixture.failure.code,
          message: "Mock failure",
          details: null,
        },
      });
      return;
    }
    if (
      !body.message.trim() ||
      [...body.message.trim()].length > 1000 ||
      [...(body.authorName?.trim() ?? "")].length > 100
    ) {
      sendJson(response, 400, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid message",
          details: null,
        },
      });
      return;
    }
    messageCommits += 1;
    if (fixture.dropResponse) response.destroy();
    else
      sendJson(
        response,
        201,
        fixture.malformed
          ? { message: {} }
          : { message: { createdAt: "2026-09-30T00:00:00Z" } },
      );
    return;
  }

  if (request.method === "POST" && pathname === "/__rsvp-fixture") {
    let json = "";
    for await (const chunk of request) json += String(chunk);
    const fixture = JSON.parse(json) as {
      rsvp?: PublicRsvpReadResponse["rsvp"];
      editBlockedReason?: PublicRsvpReadResponse["editBlockedReason"];
      checkinPass?: PublicRsvpReadResponse["checkinPass"];
      rules?: PublicInvitationResponse["invitation"]["rules"];
      delayMs?: number;
      failure?: typeof rsvpFailure;
      nextVersion?: number;
      dropResponse?: boolean;
      deadline?: string | null;
    };
    if (fixture.rsvp !== undefined) rsvpState = fixture.rsvp;
    if (fixture.editBlockedReason !== undefined)
      editBlockedReason = fixture.editBlockedReason;
    syncPass();
    if (fixture.checkinPass !== undefined) checkinPass = fixture.checkinPass;
    if (fixture.rules) rsvpRules = fixture.rules;
    rsvpDelayMs = fixture.delayMs ?? 0;
    rsvpFailure = fixture.failure ?? null;
    nextRsvpVersion = fixture.nextVersion ?? null;
    dropRsvpResponse = fixture.dropResponse ?? false;
    if (fixture.deadline !== undefined) rsvpDeadlineAt = fixture.deadline;
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && pathname === "/__rsvp-state") {
    sendJson(response, 200, {
      rsvp: rsvpState,
      requests: rsvpRequests,
      reads: rsvpReadCount,
    });
    return;
  }

  if (
    pathname.startsWith(PUBLIC_INVITATION_PATH_PREFIX) &&
    pathname.endsWith("/rsvp")
  ) {
    if (request.method === "GET") {
      rsvpReadCount += 1;
      if (rsvpFailure?.method === "GET") {
        sendJson(response, rsvpFailure.status, {
          error: {
            code: rsvpFailure.code,
            message: "Mock read failure",
            details: null,
          },
        });
      } else {
        sendJson(response, 200, {
          canEdit: editBlockedReason === null,
          editBlockedReason,
          rsvp: rsvpState,
          checkinPass,
        });
      }
      return;
    }
    if (request.method === "PUT") {
      let json = "";
      for await (const chunk of request) json += String(chunk);
      const body = JSON.parse(json) as SubmitPublicRsvpRequest;
      rsvpRequests.push(body);
      if (rsvpDelayMs)
        await new Promise((resolve) => setTimeout(resolve, rsvpDelayMs));
      if (rsvpFailure?.method === "PUT") {
        sendJson(response, rsvpFailure.status, {
          error: {
            code: rsvpFailure.code,
            message: "Mock mutation failure",
            details: null,
          },
        });
        return;
      }
      if (body.expectedVersion !== (rsvpState?.version ?? null)) {
        sendJson(response, 409, {
          error: {
            code: "RSVP_VERSION_CONFLICT",
            message: "Mock conflict",
            details: null,
          },
        });
        return;
      }
      rsvpState = {
        status: body.status,
        version: nextRsvpVersion ?? (rsvpState?.version ?? 0) + 1,
        eventSelections: body.eventSelections,
        attendees: body.attendees.map((attendee) => ({
          ...attendee,
          inviteeId: attendee.inviteeId ?? null,
        })),
        dietaryNotes: body.dietaryNotes?.trim() || null,
        attendeeQuantityTotal: body.attendees.reduce(
          (sum, attendee) => sum + attendee.quantity,
          0,
        ),
      };
      nextRsvpVersion = null;
      syncPass();
      // Simulates a committed save whose response is lost in transit.
      if (dropRsvpResponse) {
        response.destroy();
        return;
      }
      sendJson(response, 200, {
        rsvp: rsvpState,
        checkinPass,
      });
      return;
    }
  }

  if (
    request.method === "GET" &&
    pathname.startsWith(PUBLIC_INVITATION_PATH_PREFIX)
  ) {
    publicInvitationRequestCount += 1;

    const publicCredential = pathname.slice(
      PUBLIC_INVITATION_PATH_PREFIX.length,
    );

    if (publicCredential === TEST_UNAVAILABLE_CREDENTIAL) {
      sendJson(response, 404, unavailableEnvelope);
      return;
    }

    if (publicCredential === TEST_MALFORMED_CREDENTIAL) {
      sendJson(response, 200, malformedInvitationFixture);
      return;
    }

    const typography = typographyFixtures.find(
      (fixture) => fixture.credential === publicCredential,
    );

    sendJson(response, 200, {
      invitation: {
        ...publicInvitationFixture.invitation,
        ...(typography
          ? {
              displayName: typography.name,
              greetingName: typography.greetingName,
              events: publicInvitationFixture.invitation.events.map(
                (event) => ({
                  ...event,
                  name: `${event.name} bersama Keluarga Besar dan Sahabat Terkasih`,
                  venueName:
                    "Gedung Pertemuan Keluarga dan Sahabat — Ruang Perayaan Utama",
                }),
              ),
            }
          : {}),
        ...(publicCredential === "V".repeat(43)
          ? {
              events: [
                {
                  ...publicInvitationFixture.invitation.events[1],
                  id: "22222222-2222-4222-8222-222222222222",
                },
              ],
            }
          : {}),
        rules: rsvpRules,
        rsvpDeadlineAt,
      },
    });
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "MOCK_ROUTE_NOT_FOUND",
      message: "No mock route.",
      details: null,
    },
  });
});

server.listen(MOCK_PORT, MOCK_HOST);
