import { createServer, type ServerResponse } from "node:http";
import type { PublicInvitationResponse } from "../../../packages/api-client/src/index";

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
    rsvpDeadlineAt: null,
    events: [
      {
        id: "event-test-1",
        slug: "holy-matrimony-test",
        name: "Holy Matrimony Test",
        startsAt: "2027-01-09T01:00:00.000Z",
        venueName: "Test Church",
        address: "1 Test Street",
        googleMapsUrl: "https://maps.example.test/church",
      },
      {
        id: "event-test-2",
        slug: "reception-test",
        name: "Reception Test",
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

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
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
    response.writeHead(204);
    response.end();
    return;
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

    sendJson(response, 200, publicInvitationFixture);
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
