import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import {
  InvitationStatus,
  InviteeCategory,
} from "../generated/prisma/client.js";
import { conflict, notFound, validationError } from "../auth/auth-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import { CredentialService } from "../security/credential.service.js";
import { AdminReadService } from "./admin-read.service.js";
import {
  type AdminInvitationDetailResponseDto,
  type AdminInvitationPublicUrlResponseDto,
} from "./dto/admin-read.dto.js";
import type {
  ArchiveAdminInvitationResponseDto,
  CreateAdminInvitationResponseDto,
} from "./dto/admin-mutation.dto.js";
import { PublicInvitationBaseUrlService } from "./public-invitation-base-url.service.js";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const WRITABLE_UPDATE_FIELDS = new Set([
  "displayName",
  "greetingName",
  "allowPlusOne",
  "maxAdditionalChildren",
  "rsvpDeadlineAt",
  "notes",
]);
const CREATE_FIELDS = new Set([
  "displayName",
  "greetingName",
  "allowPlusOne",
  "maxAdditionalChildren",
  "rsvpDeadlineAt",
  "notes",
  "eventIds",
  "invitees",
]);
const INVITEE_FIELDS = new Set(["fullName", "category", "label"]);

type PlainObject = Record<string, unknown>;

type NormalizedInviteeInput = {
  category: InviteeCategory;
  fullName: string;
  label: string | null;
};

type NormalizedCreateInput = {
  allowPlusOne: boolean;
  displayName: string;
  eventIds: string[];
  greetingName: string | null;
  invitees: NormalizedInviteeInput[];
  maxAdditionalChildren: number;
  notes: string | null;
  rsvpDeadlineAt: Date | null;
};

type NormalizedUpdateInput = {
  expectedUpdatedAt: Date;
  values: {
    allowPlusOne?: boolean;
    displayName?: string;
    greetingName?: string | null;
    maxAdditionalChildren?: number;
    notes?: string | null;
    rsvpDeadlineAt?: Date | null;
  };
};

type LockedInvitationRow = {
  id: string;
  archivedAt: Date | null;
  openCount: number;
  firstOpenedAt: Date | null;
  lastOpenedAt: Date | null;
  publicTokenHash: string;
  publicTokenVersion: number;
  status: InvitationStatus;
  updatedAt: Date;
};

function isPlainObject(value: unknown): value is PlainObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertKnownKeys(
  value: PlainObject,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      validationError();
    }
  }
}

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    validationError();
  }
}

function normalizeRequiredText(value: unknown): string {
  if (typeof value !== "string") {
    validationError();
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    validationError();
  }

  return normalized;
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    validationError();
  }

  const normalized = value.trim();

  return normalized.length === 0 ? null : normalized;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    validationError();
  }

  return value;
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    validationError();
  }

  return value;
}

function normalizeOptionalDate(value: unknown): Date | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    validationError();
  }

  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    validationError();
  }

  return parsed;
}

function normalizeRequiredDate(value: unknown): Date {
  if (typeof value !== "string") {
    validationError();
  }

  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    validationError();
  }

  return parsed;
}

function normalizeEventIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    validationError();
  }

  const eventIds = value.map((eventId) => {
    if (typeof eventId !== "string") {
      validationError();
    }

    assertUuid(eventId);
    return eventId;
  });

  if (new Set(eventIds).size !== eventIds.length) {
    validationError();
  }

  return eventIds;
}

function normalizeInvitees(value: unknown): NormalizedInviteeInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    validationError();
  }

  return value.map((item) => {
    if (!isPlainObject(item)) {
      validationError();
    }

    assertKnownKeys(item, INVITEE_FIELDS);

    if (
      item.category !== InviteeCategory.ADULT &&
      item.category !== InviteeCategory.CHILD
    ) {
      validationError();
    }

    return {
      category: item.category,
      fullName: normalizeRequiredText(item.fullName),
      label: normalizeNullableText(item.label),
    };
  });
}

function normalizeCreateInput(body: unknown): NormalizedCreateInput {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, CREATE_FIELDS);

  return {
    allowPlusOne: normalizeBoolean(body.allowPlusOne),
    displayName: normalizeRequiredText(body.displayName),
    eventIds: normalizeEventIds(body.eventIds),
    greetingName: normalizeNullableText(body.greetingName),
    invitees: normalizeInvitees(body.invitees),
    maxAdditionalChildren: normalizeNonNegativeInteger(
      body.maxAdditionalChildren,
    ),
    notes: normalizeNullableText(body.notes),
    rsvpDeadlineAt: normalizeOptionalDate(body.rsvpDeadlineAt),
  };
}

function normalizeUpdateInput(body: unknown): NormalizedUpdateInput {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, new Set(["expectedUpdatedAt", ...WRITABLE_UPDATE_FIELDS]));

  if (!Object.hasOwn(body, "expectedUpdatedAt")) {
    validationError();
  }

  const values: NormalizedUpdateInput["values"] = {};

  if (Object.hasOwn(body, "displayName")) {
    values.displayName = normalizeRequiredText(body.displayName);
  }

  if (Object.hasOwn(body, "greetingName")) {
    values.greetingName = normalizeNullableText(body.greetingName);
  }

  if (Object.hasOwn(body, "allowPlusOne")) {
    values.allowPlusOne = normalizeBoolean(body.allowPlusOne);
  }

  if (Object.hasOwn(body, "maxAdditionalChildren")) {
    values.maxAdditionalChildren = normalizeNonNegativeInteger(
      body.maxAdditionalChildren,
    );
  }

  if (Object.hasOwn(body, "rsvpDeadlineAt")) {
    values.rsvpDeadlineAt = normalizeOptionalDate(body.rsvpDeadlineAt);
  }

  if (Object.hasOwn(body, "notes")) {
    values.notes = normalizeNullableText(body.notes);
  }

  if (Object.keys(values).length === 0) {
    validationError();
  }

  return {
    expectedUpdatedAt: normalizeRequiredDate(body.expectedUpdatedAt),
    values,
  };
}

function normalizeArchiveInput(body: unknown): void {
  if (body === undefined || body === null) {
    return;
  }

  if (!isPlainObject(body) || Object.keys(body).length !== 0) {
    validationError();
  }
}

function normalizeExpectedTokenVersion(body: unknown): number {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, new Set(["expectedTokenVersion"]));

  if (
    typeof body.expectedTokenVersion !== "number" ||
    !Number.isSafeInteger(body.expectedTokenVersion) ||
    body.expectedTokenVersion < 1
  ) {
    validationError();
  }

  return body.expectedTokenVersion;
}

function nextMonotonicTimestamp(current: Date): Date {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

@Injectable()
export class AdminMutationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService)
    private readonly credentialService: CredentialService,
    @Inject(PublicInvitationBaseUrlService)
    private readonly publicBaseUrlService: PublicInvitationBaseUrlService,
    @Inject(AdminReadService)
    private readonly adminReadService: AdminReadService,
  ) {}

  async createInvitation(body: unknown): Promise<CreateAdminInvitationResponseDto> {
    const input = normalizeCreateInput(body);
    const id = randomUUID();
    const publicTokenVersion = 1;
    const publicCredential = this.credentialService.deriveCredential({
      namespace: "invitation",
      stableId: id,
      version: publicTokenVersion,
    });
    const publicTokenHash =
      this.credentialService.hashCredential(publicCredential);

    await this.prisma.$transaction(async (tx) => {
      await this.assertActiveEvents(tx, input.eventIds);
      await tx.invitation.create({
        data: {
          allowPlusOne: input.allowPlusOne,
          displayName: input.displayName,
          greetingName: input.greetingName,
          id,
          maxAdditionalChildren: input.maxAdditionalChildren,
          notes: input.notes,
          publicTokenHash,
          publicTokenVersion,
          rsvpDeadlineAt: input.rsvpDeadlineAt,
          status: InvitationStatus.ACTIVE,
        },
      });
      await tx.invitationEvent.createMany({
        data: input.eventIds.map((eventId) => ({
          eventId,
          invitationId: id,
        })),
      });
      await tx.invitee.createMany({
        data: input.invitees.map((invitee, index) => ({
          category: invitee.category,
          displayOrder: index,
          fullName: invitee.fullName,
          invitationId: id,
          label: invitee.label,
        })),
      });
    });

    const detail = await this.adminReadService.getInvitationDetail(id);

    return {
      invitation: detail.invitation,
      publicTokenVersion,
      publicUrl: this.publicBaseUrlService.buildInvitationUrl(publicCredential),
    };
  }

  async updateInvitation(
    invitationId: string,
    body: unknown,
  ): Promise<AdminInvitationDetailResponseDto> {
    assertUuid(invitationId);
    const input = normalizeUpdateInput(body);

    await this.prisma.$transaction(async (tx) => {
      const invitation = await this.lockInvitation(tx, invitationId);
      this.assertInvitationActive(invitation);

      if (
        invitation.updatedAt.toISOString() !==
        input.expectedUpdatedAt.toISOString()
      ) {
        conflict("Invitation has changed.");
      }

      await tx.invitation.update({
        data: {
          ...input.values,
          updatedAt: nextMonotonicTimestamp(invitation.updatedAt),
        },
        where: { id: invitation.id },
      });
    });

    return this.adminReadService.getInvitationDetail(invitationId);
  }

  async archiveInvitation(
    invitationId: string,
    body: unknown,
  ): Promise<ArchiveAdminInvitationResponseDto> {
    assertUuid(invitationId);
    normalizeArchiveInput(body);

    const archived = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.lockInvitation(tx, invitationId);

      if (invitation.status === InvitationStatus.ARCHIVED) {
        if (invitation.archivedAt === null) {
          throw new Error("Archived invitation is missing archivedAt.");
        }

        return {
          archivedAt: invitation.archivedAt,
          id: invitation.id,
        };
      }

      const archivedAt = new Date();
      const updated = await tx.invitation.update({
        data: {
          archivedAt,
          status: InvitationStatus.ARCHIVED,
          updatedAt: nextMonotonicTimestamp(invitation.updatedAt),
        },
        select: {
          archivedAt: true,
          id: true,
        },
        where: { id: invitation.id },
      });

      if (updated.archivedAt === null) {
        throw new Error("Failed to archive invitation.");
      }

      return {
        archivedAt: updated.archivedAt,
        id: updated.id,
      };
    });

    return {
      invitation: {
        archivedAt: archived.archivedAt.toISOString(),
        id: archived.id,
        status: InvitationStatus.ARCHIVED,
      },
    };
  }

  async regenerateInvitationToken(
    invitationId: string,
    body: unknown,
  ): Promise<AdminInvitationPublicUrlResponseDto> {
    assertUuid(invitationId);
    const expectedTokenVersion = normalizeExpectedTokenVersion(body);

    const result = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.lockInvitation(tx, invitationId);
      this.assertInvitationActive(invitation);

      if (invitation.publicTokenVersion !== expectedTokenVersion) {
        conflict("Invitation public token version has changed.");
      }

      const nextVersion = invitation.publicTokenVersion + 1;
      const credential = this.credentialService.deriveCredential({
        namespace: "invitation",
        stableId: invitation.id,
        version: nextVersion,
      });
      const publicTokenHash = this.credentialService.hashCredential(credential);

      await tx.invitation.update({
        data: {
          publicTokenHash,
          publicTokenVersion: nextVersion,
          updatedAt: nextMonotonicTimestamp(invitation.updatedAt),
        },
        where: { id: invitation.id },
      });

      return {
        credential,
        publicTokenVersion: nextVersion,
      };
    });

    return {
      publicTokenVersion: result.publicTokenVersion,
      publicUrl: this.publicBaseUrlService.buildInvitationUrl(result.credential),
    };
  }

  private async assertActiveEvents(
    tx: Prisma.TransactionClient,
    eventIds: readonly string[],
  ): Promise<void> {
    const events = await tx.event.findMany({
      select: { id: true, isActive: true },
      where: { id: { in: [...eventIds] } },
    });

    if (events.length !== eventIds.length || events.some((event) => !event.isActive)) {
      validationError();
    }
  }

  private assertInvitationActive(invitation: LockedInvitationRow): void {
    if (invitation.status !== InvitationStatus.ACTIVE) {
      conflict("Invitation is archived.");
    }
  }

  private async lockInvitation(
    tx: Prisma.TransactionClient,
    invitationId: string,
  ): Promise<LockedInvitationRow> {
    const rows = await tx.$queryRaw<LockedInvitationRow[]>`
      SELECT
        "id",
        "archived_at" AS "archivedAt",
        "first_opened_at" AS "firstOpenedAt",
        "last_opened_at" AS "lastOpenedAt",
        "open_count" AS "openCount",
        "public_token_hash" AS "publicTokenHash",
        "public_token_version" AS "publicTokenVersion",
        "status"::text AS "status",
        "updated_at" AS "updatedAt"
      FROM "invitations"
      WHERE "id" = ${invitationId}::uuid
      FOR UPDATE
    `;
    const invitation = rows[0];

    if (invitation === undefined) {
      notFound();
    }

    return invitation;
  }
}
