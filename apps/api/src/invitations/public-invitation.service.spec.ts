import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service.js";
import type { CredentialService } from "../security/credential.service.js";
import { InvitationNotAvailableError } from "./invitation-not-available.error.js";
import { PublicInvitationService } from "./public-invitation.service.js";

describe("PublicInvitationService", () => {
  it.each(["short", "A".repeat(44), `${"A".repeat(42)}=`, ` ${"A".repeat(42)}`, `${"A".repeat(42)}!`])(
    "rejects malformed credential %s before hashing or database access",
    async (credential) => {
      const prisma = {
        $transaction: vi.fn(),
      } as unknown as PrismaService;
      const credentialHasher = {
        hashCredential: vi.fn(),
      } as unknown as CredentialService;
      const service = new PublicInvitationService(prisma, credentialHasher);

      await expect(service.retrievePublicInvitation(credential)).rejects.toBeInstanceOf(
        InvitationNotAvailableError,
      );

      expect(credentialHasher.hashCredential).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it("keeps unavailable errors generic and free of raw input", async () => {
    const rawCredential = `${"A".repeat(42)}=`;
    const service = new PublicInvitationService(
      { $transaction: vi.fn() } as unknown as PrismaService,
      { hashCredential: vi.fn() } as unknown as CredentialService,
    );

    try {
      await service.retrievePublicInvitation(rawCredential);
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVITATION_NOT_AVAILABLE",
        message: "Resource not found",
        details: null,
      });
      expect(JSON.stringify(error)).not.toContain(rawCredential);
      expect(String(error)).not.toContain(rawCredential);
    }
  });
});
