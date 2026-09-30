import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDatabaseUrl } from "../database/database-url.js";
import { AdminRole, AdminUserStatus, PrismaClient } from "../generated/prisma/client.js";
import { AdminPasswordService } from "./password.service.js";
import { bootstrapOwner } from "./bootstrap-owner.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const passwordService = new AdminPasswordService();

async function cleanAdminAuth() {
  await prisma.checkinRecord.deleteMany();
  await prisma.guestImportBatch.deleteMany();
  await prisma.rSVP.updateMany({
    data: { submittedByAdminUserId: null },
    where: { submittedByAdminUserId: { not: null } },
  });
  await prisma.adminSession.deleteMany();
  await prisma.adminUser.deleteMany();
}

beforeEach(async () => {
  await cleanAdminAuth();
});

afterAll(async () => {
  await cleanAdminAuth();
  await prisma.$disconnect();
});

describe("bootstrapOwner", () => {
  it("creates the first OWNER with normalized email and Argon2id password hash", async () => {
    const result = await bootstrapOwner({
      email: "  OWNER@Example.COM  ",
      password: "correct horse battery staple",
      passwordService,
      prisma,
    });
    const users = await prisma.adminUser.findMany();
    const sessions = await prisma.adminSession.findMany();

    expect(result).toEqual({
      created: true,
      email: "owner@example.com",
    });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: "owner@example.com",
      role: AdminRole.OWNER,
      status: AdminUserStatus.ACTIVE,
    });
    expect(users[0]!.passwordHash).toContain("$argon2id$");
    expect(users[0]!.passwordHash).not.toContain("correct horse");
    await expect(
      passwordService.verifyPassword(
        users[0]!.passwordHash,
        "correct horse battery staple",
      ),
    ).resolves.toBe(true);
    expect(sessions).toHaveLength(0);
  });

  it("refuses repeat bootstrap without updating the existing account", async () => {
    await bootstrapOwner({
      email: "owner@example.com",
      password: "correct horse battery staple",
      passwordService,
      prisma,
    });
    const before = await prisma.adminUser.findFirstOrThrow();

    const result = await bootstrapOwner({
      email: "new@example.com",
      password: "another correct battery",
      passwordService,
      prisma,
    });
    const users = await prisma.adminUser.findMany();

    expect(result).toEqual({
      created: false,
      reason: "ADMIN_USER_EXISTS",
    });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: before.email,
      passwordHash: before.passwordHash,
    });
  });

  it("serializes concurrent bootstrap attempts so exactly one OWNER is created", async () => {
    const results = await Promise.all([
      bootstrapOwner({
        email: "owner-a@example.com",
        password: "correct horse battery staple",
        passwordService,
        prisma,
      }),
      bootstrapOwner({
        email: "owner-b@example.com",
        password: "another correct battery",
        passwordService,
        prisma,
      }),
    ]);
    const users = await prisma.adminUser.findMany();

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    expect(users).toHaveLength(1);
  });
});
