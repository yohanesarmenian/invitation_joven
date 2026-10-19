import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Native import of compiled API modules avoids Playwright's CommonJS transform
// of Prisma's import.meta and Nest's parameter decorators. Build the API first.
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;
const compiled = (file: string) =>
  nativeImport(pathToFileURL(resolve(process.cwd(), "../api/dist", file)).href);

export async function createWorkflowFixture() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname))
    throw new Error("Workflow fixtures require a local QA database.");
  const { PrismaService } = (await compiled(
    "database/prisma.service.js",
  )) as typeof import("../src/database/prisma.service.js");
  const { AdminPasswordService } = (await compiled(
    "auth/password.service.js",
  )) as {
    AdminPasswordService: new () => {
      hashPassword(value: string): Promise<string>;
    };
  };
  const { CredentialService } = (await compiled(
    "security/credential.service.js",
  )) as {
    CredentialService: new (provider: unknown) => {
      deriveCredential(input: {
        namespace: "invitation" | "check-in";
        stableId: string;
        version: number;
      }): string;
      hashCredential(value: string): string;
    };
  };
  const { CredentialSecretProvider } = (await compiled(
    "security/credential-secret.provider.js",
  )) as { CredentialSecretProvider: new () => unknown };
  const prisma = new PrismaService();
  const identity = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database() AS name`;
  if (
    process.env.INVITATION_WORKFLOW_TEST !== "1" ||
    !/^invitation_(qa_[a-z0-9_]+|ci|workflow_smoke)$/.test(
      identity[0]?.name ?? "",
    )
  ) {
    await prisma.$disconnect();
    throw new Error(
      "Workflow fixtures require an explicitly isolated QA database.",
    );
  }
  const credential = new CredentialService(new CredentialSecretProvider());
  const password = "synthetic workflow password";
  const passwordHash = await new AdminPasswordService().hashPassword(password);
  const unique = randomUUID();
  const owner = await prisma.adminUser.create({
    data: { email: `owner-${unique}@example.com`, role: "OWNER", passwordHash },
  });
  const staff = await prisma.adminUser.create({
    data: {
      email: `staff-${unique}@example.com`,
      role: "CHECKIN_STAFF",
      passwordHash,
    },
  });
  const event = await prisma.event.create({
    data: {
      name: `Workflow Reception ${unique}`,
      slug: `workflow-${unique}`,
      displayOrder: randomInt(1, 1_000_000_000),
      startsAt: new Date("2027-01-02T10:00:00Z"),
      endsAt: new Date("2027-01-02T12:00:00Z"),
      venueName: "Synthetic venue",
      address: "Synthetic address",
    },
  });
  const invitations: Array<{
    id: string;
    qrPayload: string;
    publicCredential: string;
    name: string;
  }> = [];
  async function household(
    name: string,
    options: { pending?: boolean; plusOne?: boolean; children?: number } = {},
  ) {
    const id = randomUUID(),
      publicCredential = credential.deriveCredential({
        namespace: "invitation",
        stableId: id,
        version: 1,
      });
    await prisma.invitation.create({
      data: {
        id,
        displayName: name,
        allowPlusOne: options.plusOne ?? false,
        maxAdditionalChildren: options.children ?? 0,
        publicTokenHash: credential.hashCredential(publicCredential),
        rsvpDeadlineAt: new Date("2027-12-01T00:00:00Z"),
        invitationEvents: { create: { eventId: event.id } },
      },
    });
    const invitee = await prisma.invitee.create({
      data: {
        invitationId: id,
        fullName: "Synthetic Guest",
        category: "ADULT",
        displayOrder: 1,
      },
    });
    if (options.pending) {
      const fixture = { id, qrPayload: "", publicCredential, name };
      invitations.push(fixture);
      return fixture;
    }
    const rsvp = await prisma.rSVP.create({
      data: {
        invitationId: id,
        status: "ACCEPTED",
        version: 1,
        attendees: {
          create: {
            attendeeType: "NAMED_INVITEE",
            inviteeId: invitee.id,
            quantity: 1,
          },
        },
        eventSelections: {
          create: {
            eventId: event.id,
            attending: true,
            expectedAttendeeCount: 1,
          },
        },
      },
    });
    const passId = randomUUID(),
      qrPayload = credential.deriveCredential({
        namespace: "check-in",
        stableId: passId,
        version: 1,
      });
    await prisma.checkinPass.create({
      data: {
        id: passId,
        invitationId: id,
        rsvpId: rsvp.id,
        tokenHash: credential.hashCredential(qrPayload),
        credentialVersion: 1,
        status: "ACTIVE",
      },
    });
    const fixture = { id, qrPayload, publicCredential, name };
    invitations.push(fixture);
    return fixture;
  }
  async function cleanup() {
    const ids = invitations.map((item) => item.id);
    await prisma.checkinRecord.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await prisma.checkinPass.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await prisma.rSVP.deleteMany({ where: { invitationId: { in: ids } } });
    await prisma.guestMessage.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await prisma.invitee.deleteMany({ where: { invitationId: { in: ids } } });
    await prisma.invitationEvent.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await prisma.invitation.deleteMany({ where: { id: { in: ids } } });
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.adminSession.deleteMany({
      where: { adminUserId: { in: [owner.id, staff.id] } },
    });
    await prisma.adminUser.deleteMany({
      where: { id: { in: [owner.id, staff.id] } },
    });
    await prisma.$disconnect();
  }
  return { prisma, password, owner, staff, event, household, cleanup };
}
