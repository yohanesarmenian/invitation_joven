import { writeFileSync } from "node:fs";
import { PrismaService } from "../src/database/prisma.service.js";
import {
  CheckinPassStatus,
  InvitationStatus,
  InviteeCategory,
} from "../src/generated/prisma/enums.js";
import { CredentialSecretProvider } from "../src/security/credential-secret.provider.js";
import { CredentialService } from "../src/security/credential.service.js";

/**
 * Test/tooling-only fixture for the real full-stack browser smoke (Phase 4
 * Slice 5C). It is not a production entrypoint and is never imported by the
 * Nest application; `tsconfig.json` only includes `src/**`, so this file is
 * outside the production build.
 *
 * Every operation refuses to run unless the connected database identifies
 * itself as the dedicated isolated smoke database.
 */
const SMOKE_DATABASE_NAME = "invitation_5c_smoke";
const SMOKE_DATABASE_ROLE = "invitation_5c_smoke";

// Deterministic IDs reserved for 5C smoke. Never reused by any other fixture.
const SMOKE_INVITATION_ID = "5c000000-0000-4000-8000-000000000001";
const SMOKE_EVENT_ID = "5c000000-0000-4000-8000-000000000002";
const SMOKE_INVITEE_ID = "5c000000-0000-4000-8000-000000000003";

// Event.displayOrder is globally unique, so a smoke-reserved slot is required.
// 9001 is free in the isolated smoke database; a foreign owner is a hard error.
const SMOKE_EVENT_DISPLAY_ORDER = 9001;
const SMOKE_EVENT_SLUG = "5c-smoke-ceremony";

const PUBLIC_TOKEN_VERSION = 1;

interface IdentityRow {
  databaseName: string;
  roleName: string;
}

type SmokeState = {
  beforeOpenCount: number;
  eventId: string;
  invitationId: string;
  publicCredential: string;
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readStatePath(args: readonly string[]): string {
  const index = args.indexOf("--state");
  const value = index === -1 ? undefined : args[index + 1];

  if (value === undefined || value.length === 0) {
    fail("--state <path> is required.");
  }

  return value;
}

async function assertIsolatedDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<IdentityRow[]>`
    SELECT current_database() AS "databaseName", current_user AS "roleName"
  `;
  const identity = rows[0];

  if (
    identity === undefined ||
    identity.databaseName !== SMOKE_DATABASE_NAME ||
    identity.roleName !== SMOKE_DATABASE_ROLE
  ) {
    fail(
      `Refusing to run: expected database "${SMOKE_DATABASE_NAME}" as role "${SMOKE_DATABASE_ROLE}". Aborting before any mutation.`,
    );
  }
}

/**
 * Deletes only rows carrying the exact deterministic smoke IDs. Safe to run
 * repeatedly, which is how an interrupted prior run is recovered.
 *
 * Order matters, and every step below is `onDelete: Restrict` in the schema:
 * a check-in record references its pass, `checkin_passes` reference the
 * invitation and the RSVP, and `rsvp_attendees` reference an invitee. So the
 * RSVP must go before the invitees it names, and the passes before the RSVP.
 * Until Phase 6 this fixture seeded no RSVP at all, which is why the earlier
 * invitee/RSVP order was never exercised.
 */
async function deleteSmokeRows(prisma: PrismaService): Promise<void> {
  await prisma.checkinRecord.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.checkinPass.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  // Cascades to rsvp_attendees and rsvp_event_selections, which is what frees
  // the invitees for deletion below.
  await prisma.rSVP.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.invitationEvent.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.invitee.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.invitation.deleteMany({ where: { id: SMOKE_INVITATION_ID } });
  await prisma.event.deleteMany({ where: { id: SMOKE_EVENT_ID } });
}

async function assertReservedEventSlotIsFree(
  prisma: PrismaService,
): Promise<void> {
  const conflicts = await prisma.event.findMany({
    where: {
      OR: [
        { displayOrder: SMOKE_EVENT_DISPLAY_ORDER },
        { slug: SMOKE_EVENT_SLUG },
      ],
    },
    select: { displayOrder: true, id: true, slug: true },
  });
  const foreign = conflicts.filter((event) => event.id !== SMOKE_EVENT_ID);

  if (foreign.length > 0) {
    fail(
      `Refusing to run: reserved smoke Event slot is owned by other events (ids: ${foreign
        .map((event) => event.id)
        .join(", ")}). Pick another reserved value; nothing was deleted.`,
    );
  }
}

async function setup(prisma: PrismaService, statePath: string): Promise<void> {
  const credentialSecretProvider = new CredentialSecretProvider();
  const credentialService = new CredentialService(credentialSecretProvider);

  const publicCredential = credentialService.deriveCredential({
    namespace: "invitation",
    stableId: SMOKE_INVITATION_ID,
    version: PUBLIC_TOKEN_VERSION,
  });
  const publicTokenHash = credentialService.hashCredential(publicCredential);

  await deleteSmokeRows(prisma);
  await assertReservedEventSlotIsFree(prisma);

  await prisma.event.create({
    data: {
      displayOrder: SMOKE_EVENT_DISPLAY_ORDER,
      id: SMOKE_EVENT_ID,
      name: "5C Smoke Ceremony",
      slug: SMOKE_EVENT_SLUG,
      startsAt: new Date("2027-03-14T01:30:00.000Z"),
      venueName: "5C Smoke Venue",
      address: "1 Smoke Test Lane",
      googleMapsUrl: "https://maps.example.test/5c-smoke",
    },
  });

  const invitation = await prisma.invitation.create({
    data: {
      displayName: "5C Smoke Household",
      greetingName: "Smoke Guest",
      id: SMOKE_INVITATION_ID,
      publicTokenHash,
      publicTokenVersion: PUBLIC_TOKEN_VERSION,
      status: InvitationStatus.ACTIVE,
      allowPlusOne: false,
      maxAdditionalChildren: 0,
      openCount: 0,
    },
    select: { openCount: true },
  });

  await prisma.invitee.create({
    data: {
      category: InviteeCategory.ADULT,
      displayOrder: 1,
      fullName: "5C Smoke Invitee",
      id: SMOKE_INVITEE_ID,
      invitationId: SMOKE_INVITATION_ID,
    },
  });

  await prisma.invitationEvent.create({
    data: {
      eventId: SMOKE_EVENT_ID,
      invitationId: SMOKE_INVITATION_ID,
    },
  });

  const state: SmokeState = {
    beforeOpenCount: invitation.openCount,
    eventId: SMOKE_EVENT_ID,
    invitationId: SMOKE_INVITATION_ID,
    publicCredential,
  };

  writeFileSync(statePath, JSON.stringify(state), {
    encoding: "utf8",
    mode: 0o600,
  });

  // Only non-secret summary reaches stdout.
  process.stdout.write(
    `${JSON.stringify({
      eventId: SMOKE_EVENT_ID,
      invitationId: SMOKE_INVITATION_ID,
      openCount: invitation.openCount,
      status: "setup-complete",
    })}\n`,
  );
}

async function read(prisma: PrismaService): Promise<void> {
  const invitation = await prisma.invitation.findUnique({
    where: { id: SMOKE_INVITATION_ID },
    select: { firstOpenedAt: true, lastOpenedAt: true, openCount: true },
  });

  if (invitation === null) {
    fail("Smoke fixture invitation is missing.");
  }

  process.stdout.write(
    `${JSON.stringify({
      firstOpenedAtPresent: invitation.firstOpenedAt !== null,
      lastOpenedAtPresent: invitation.lastOpenedAt !== null,
      openCount: invitation.openCount,
    })}\n`,
  );
}

/**
 * Removes RSVP and pass rows only, leaving the invitation, event and invitee in
 * place. This gives each Phase 6 lifecycle scenario a known empty starting
 * state without re-running the whole seed.
 */
async function resetRsvp(prisma: PrismaService): Promise<void> {
  await prisma.checkinRecord.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.checkinPass.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.rSVP.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });

  process.stdout.write(`${JSON.stringify({ status: "rsvp-reset" })}\n`);
}

/**
 * Reports the persisted pass lifecycle state for the smoke invitation.
 *
 * It re-derives the ACTIVE pass credential through the exact production
 * `CredentialService` and compares it to the stored `token_hash`, so the test
 * can assert the hash correspondence without ever seeing either value. The
 * credential and the hash are never written to stdout; only booleans, counts,
 * and opaque row ids (used for DOM-absence assertions) are returned.
 */
async function readPassState(prisma: PrismaService): Promise<void> {
  const credentialService = new CredentialService(
    new CredentialSecretProvider(),
  );

  const rsvp = await prisma.rSVP.findFirst({
    where: { invitationId: SMOKE_INVITATION_ID },
    select: { status: true, version: true },
  });
  const passes = await prisma.checkinPass.findMany({
    where: { invitationId: SMOKE_INVITATION_ID },
    orderBy: { issuedAt: "asc" },
    select: {
      credentialVersion: true,
      id: true,
      revokedAt: true,
      status: true,
      tokenHash: true,
    },
  });
  const active = passes.filter(
    (pass) => pass.status === CheckinPassStatus.ACTIVE,
  );
  const revoked = passes.filter(
    (pass) => pass.status === CheckinPassStatus.REVOKED,
  );

  let activeHashMatches: boolean | null = null;

  if (active.length === 1 && active[0] !== undefined) {
    const [single] = active;
    const derived = credentialService.deriveCredential({
      namespace: "check-in",
      stableId: single.id,
      version: single.credentialVersion,
    });

    activeHashMatches =
      credentialService.hashCredential(derived) === single.tokenHash;
  }

  process.stdout.write(
    `${JSON.stringify({
      activeHashMatches,
      activePassCount: active.length,
      activePassIds: active.map((pass) => pass.id),
      revokedPassCount: revoked.length,
      revokedPassIds: revoked.map((pass) => pass.id),
      revokedWithRevocationReasonCount: revoked.filter(
        (pass) => pass.revokedAt !== null,
      ).length,
      rsvpStatus: rsvp?.status ?? null,
      rsvpVersion: rsvp?.version ?? null,
      status: "pass-state",
      totalPassCount: passes.length,
    })}\n`,
  );
}

/**
 * Moves `rsvp_deadline_at` into the past (or back to `null`) so the real
 * deadline path can be exercised without waiting for a wall-clock date. Only
 * the smoke invitation is touched.
 */
async function setDeadline(
  prisma: PrismaService,
  args: readonly string[],
): Promise<void> {
  const value =
    args[0] === "past" ? new Date("2020-01-01T00:00:00.000Z") : null;

  const invitation = await prisma.invitation.update({
    data: { rsvpDeadlineAt: value },
    select: { rsvpDeadlineAt: true },
    where: { id: SMOKE_INVITATION_ID },
  });

  process.stdout.write(
    `${JSON.stringify({
      deadlineSet: invitation.rsvpDeadlineAt !== null,
      status: "deadline-set",
    })}\n`,
  );
}

async function countRemainingSmokeRows(prisma: PrismaService) {
  const [
    invitationCount,
    inviteeCount,
    invitationEventCount,
    eventCount,
    rsvpCount,
    checkinPassCount,
    checkinRecordCount,
  ] = await Promise.all([
    prisma.invitation.count({ where: { id: SMOKE_INVITATION_ID } }),
    prisma.invitee.count({ where: { invitationId: SMOKE_INVITATION_ID } }),
    prisma.invitationEvent.count({
      where: { invitationId: SMOKE_INVITATION_ID },
    }),
    prisma.event.count({ where: { id: SMOKE_EVENT_ID } }),
    prisma.rSVP.count({ where: { invitationId: SMOKE_INVITATION_ID } }),
    prisma.checkinPass.count({ where: { invitationId: SMOKE_INVITATION_ID } }),
    prisma.checkinRecord.count({
      where: { invitationId: SMOKE_INVITATION_ID },
    }),
  ]);

  return {
    checkinPass: checkinPassCount,
    checkinRecord: checkinRecordCount,
    event: eventCount,
    invitation: invitationCount,
    invitationEvent: invitationEventCount,
    invitee: inviteeCount,
    rsvp: rsvpCount,
  };
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await deleteSmokeRows(prisma);

  const remaining = await countRemainingSmokeRows(prisma);
  const residue = Object.values(remaining).some((count) => count !== 0);

  process.stdout.write(
    `${JSON.stringify({ remaining, status: residue ? "cleanup-incomplete" : "cleanup-complete" })}\n`,
  );

  if (residue) {
    fail("Cleanup verification failed: smoke fixture rows remain.");
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const prisma = new PrismaService();

  try {
    await prisma.$connect();
    await assertIsolatedDatabase(prisma);

    switch (command) {
      case "setup":
        await setup(prisma, readStatePath(args));
        return;
      case "read":
        await read(prisma);
        return;
      case "reset-rsvp":
        await resetRsvp(prisma);
        return;
      case "pass-state":
        await readPassState(prisma);
        return;
      case "set-deadline":
        await setDeadline(prisma, args);
        return;
      case "cleanup":
        await cleanup(prisma);
        return;
      default:
        fail(
          `Unknown command "${command ?? ""}". Use setup, read, reset-rsvp, pass-state, set-deadline or cleanup.`,
        );
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
