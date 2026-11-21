import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { InvitationNotAvailableError } from "../invitations/invitation-not-available.error.js";
import { validatePublicCredential } from "../invitations/public-invitation.service.js";
import { CredentialService } from "../security/credential.service.js";
import type { CredentialLookupHash } from "../security/credential.types.js";

export type SubmitPublicGuestMessageCommand = {
  publicCredential: string;
  authorName: string | null;
  message: string;
  submissionId?: string;
};

export type PublicGuestMessageResult = {
  message: {
    createdAt: string;
  };
};

type CreatedGuestMessageRow = {
  createdAt: Date;
};

async function createGuestMessageForActiveInvitation(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    lookupHash: CredentialLookupHash;
    authorName: string | null;
    message: string;
  },
): Promise<CreatedGuestMessageRow> {
  const rows = await tx.$queryRaw<CreatedGuestMessageRow[]>`
    INSERT INTO "guest_messages" ("id", "invitation_id", "author_name", "message")
    SELECT ${input.id}::uuid, "id", ${input.authorName}, ${input.message}
    FROM "invitations"
    WHERE "public_token_hash" = ${input.lookupHash}
      AND "status" = 'ACTIVE'
    ON CONFLICT ("id") DO NOTHING
    RETURNING "created_at" AS "createdAt"
  `;
  if (rows[0]) return rows[0];

  // A separate statement can see the winning row after a concurrent insert.
  const [existing] = await tx.$queryRaw<CreatedGuestMessageRow[]>`
    SELECT m."created_at" AS "createdAt"
    FROM "guest_messages" m
    JOIN "invitations" i ON i."id" = m."invitation_id"
    WHERE i."public_token_hash" = ${input.lookupHash} AND i."status" = 'ACTIVE'
      AND m."id" = ${input.id}::uuid
      AND m."author_name" IS NOT DISTINCT FROM ${input.authorName}::text
      AND m."message" = ${input.message}
  `;
  if (!existing) throw new InvitationNotAvailableError();
  return existing;
}

@Injectable()
export class PublicGuestMessageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService)
    private readonly credentialService: CredentialService,
  ) {}

  async submitPublicGuestMessage(
    command: SubmitPublicGuestMessageCommand,
  ): Promise<PublicGuestMessageResult> {
    const credential = validatePublicCredential(command.publicCredential);
    const lookupHash = this.credentialService.hashCredential(credential);

    const message = await this.prisma.$transaction((tx) =>
      createGuestMessageForActiveInvitation(tx, {
        authorName: command.authorName,
        id: command.submissionId ?? randomUUID(),
        lookupHash,
        message: command.message,
      }),
    );

    return {
      message: {
        createdAt: message.createdAt.toISOString(),
      },
    };
  }

  async readReceipt(
    publicCredential: string,
    submissionId: string,
  ): Promise<PublicGuestMessageResult> {
    const credential = validatePublicCredential(publicCredential);
    const lookupHash = this.credentialService.hashCredential(credential);
    const [row] = await this.prisma.$queryRaw<CreatedGuestMessageRow[]>`
      SELECT m."created_at" AS "createdAt"
      FROM "guest_messages" m
      JOIN "invitations" i ON i."id" = m."invitation_id"
      WHERE i."public_token_hash" = ${lookupHash} AND i."status" = 'ACTIVE'
        AND m."id" = ${submissionId}::uuid
    `;
    if (!row) throw new InvitationNotAvailableError();
    return { message: { createdAt: row.createdAt.toISOString() } };
  }
}
