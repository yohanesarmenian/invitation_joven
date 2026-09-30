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
    RETURNING "created_at" AS "createdAt"
  `;
  const message = rows[0];

  if (!message) {
    throw new InvitationNotAvailableError();
  }

  return message;
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
        id: randomUUID(),
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
}
