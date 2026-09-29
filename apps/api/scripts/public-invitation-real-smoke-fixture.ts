import { writeFileSync } from "node:fs";
import { PrismaService } from "../src/database/prisma.service.js";
import {
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
 */
async function deleteSmokeRows(prisma: PrismaService): Promise<void> {
  await prisma.invitationEvent.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.invitee.deleteMany({
    where: { invitationId: SMOKE_INVITATION_ID },
  });
  await prisma.rSVP.deleteMany({
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

async function countRemainingSmokeRows(prisma: PrismaService) {
  const [
    invitationCount,
    inviteeCount,
    invitationEventCount,
    eventCount,
    rsvpCount,
  ] = await Promise.all([
    prisma.invitation.count({ where: { id: SMOKE_INVITATION_ID } }),
    prisma.invitee.count({ where: { invitationId: SMOKE_INVITATION_ID } }),
    prisma.invitationEvent.count({
      where: { invitationId: SMOKE_INVITATION_ID },
    }),
    prisma.event.count({ where: { id: SMOKE_EVENT_ID } }),
    prisma.rSVP.count({ where: { invitationId: SMOKE_INVITATION_ID } }),
  ]);

  return {
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
      case "cleanup":
        await cleanup(prisma);
        return;
      default:
        fail(`Unknown command "${command ?? ""}". Use setup, read or cleanup.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
