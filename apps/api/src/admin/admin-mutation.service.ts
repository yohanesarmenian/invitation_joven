import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import {
  InvitationStatus,
  InviteeCategory,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { conflict, notFound, validationError } from "../auth/auth-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  PublicRsvpService,
  type SubmitAdminRsvpOverrideCommand,
} from "../invitations/public-rsvp.service.js";
import { CredentialService } from "../security/credential.service.js";
import { AdminReadService } from "./admin-read.service.js";
import {
  type AdminGuestMessageItemDto,
  type AdminRsvpDetailResponseDto,
  type AdminInvitationDetailResponseDto,
  type AdminInvitationPublicUrlResponseDto,
} from "./dto/admin-read.dto.js";
import type {
  AdminInviteeMutationDto,
  ArchiveAdminInvitationResponseDto,
  CreateAdminInvitationResponseDto,
  ReplaceAdminInvitationEventsResponseDto,
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
const UPDATE_INVITEE_FIELDS = new Set([
  "expectedUpdatedAt",
  "fullName",
  "category",
  "label",
]);
const REPLACE_EVENTS_FIELDS = new Set(["eventIds"]);
const OVERRIDE_RSVP_FIELDS = new Set([
  "attendees",
  "dietaryNotes",
  "eventSelections",
  "expectedVersion",
  "overrideReason",
  "status",
]);
const UPDATE_GUEST_MESSAGE_FIELDS = new Set(["isHidden"]);
const OVERRIDE_REASON_MAX_CODE_POINTS = 500;

type PlainObject = Record<string, unknown>;

export type NormalizedInviteeInput = {
  category: InviteeCategory;
  fullName: string;
  label: string | null;
};

export type NormalizedCreateInput = {
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

type NormalizedInviteeUpdateInput = {
  expectedUpdatedAt: Date;
  values: {
    category?: InviteeCategory;
    fullName?: string;
    label?: string | null;
  };
};

type NormalizedAdminRsvpOverrideInput = Omit<
  SubmitAdminRsvpOverrideCommand,
  "invitationId" | "submittedByAdminUserId"
>;

type NormalizedGuestMessageUpdateInput = {
  isHidden: boolean;
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

type InviteeMutationRow = {
  id: string;
  invitationId: string;
  fullName: string;
  category: InviteeCategory;
  label: string | null;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeExpectedVersion(value: unknown): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }

  validationError();
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

function normalizeReplacementEventIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
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

function normalizeOverrideReason(value: unknown): string {
  const normalized = normalizeRequiredText(value);

  if ([...normalized].length > OVERRIDE_REASON_MAX_CODE_POINTS) {
    validationError();
  }

  return normalized;
}

function normalizeRsvpStatus(
  value: unknown,
): NormalizedAdminRsvpOverrideInput["status"] {
  if (value === RSVPStatus.ACCEPTED || value === RSVPStatus.DECLINED) {
    return value;
  }

  validationError();
}

function normalizeRsvpEventSelections(
  value: unknown,
): NormalizedAdminRsvpOverrideInput["eventSelections"] {
  if (!Array.isArray(value)) {
    validationError();
  }

  return value.map((selection) => {
    if (!isPlainObject(selection)) {
      validationError();
    }

    assertKnownKeys(
      selection,
      new Set(["attending", "eventId", "expectedAttendeeCount"]),
    );

    if (typeof selection.attending !== "boolean") {
      validationError();
    }

    if (
      typeof selection.eventId !== "string" ||
      !UUID_PATTERN.test(selection.eventId)
    ) {
      validationError();
    }

    if (
      typeof selection.expectedAttendeeCount !== "number" ||
      !Number.isSafeInteger(selection.expectedAttendeeCount) ||
      selection.expectedAttendeeCount < 0
    ) {
      validationError();
    }

    return {
      attending: selection.attending,
      eventId: selection.eventId,
      expectedAttendeeCount: selection.expectedAttendeeCount,
    };
  });
}

function normalizeRsvpAttendees(
  value: unknown,
): NormalizedAdminRsvpOverrideInput["attendees"] {
  if (!Array.isArray(value)) {
    validationError();
  }

  return value.map((attendee) => {
    if (!isPlainObject(attendee)) {
      validationError();
    }

    assertKnownKeys(attendee, new Set(["inviteeId", "quantity", "type"]));

    if (
      attendee.type !== RSVPAttendeeType.NAMED_INVITEE &&
      attendee.type !== RSVPAttendeeType.PLUS_ONE &&
      attendee.type !== RSVPAttendeeType.ADDITIONAL_CHILD
    ) {
      validationError();
    }

    if (
      attendee.inviteeId !== undefined &&
      attendee.inviteeId !== null &&
      (typeof attendee.inviteeId !== "string" ||
        !UUID_PATTERN.test(attendee.inviteeId))
    ) {
      validationError();
    }

    if (
      typeof attendee.quantity !== "number" ||
      !Number.isSafeInteger(attendee.quantity) ||
      attendee.quantity < 1
    ) {
      validationError();
    }

    return {
      inviteeId: attendee.inviteeId,
      quantity: attendee.quantity,
      type: attendee.type,
    };
  });
}

function normalizeAdminRsvpOverrideInput(
  body: unknown,
): NormalizedAdminRsvpOverrideInput {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, OVERRIDE_RSVP_FIELDS);

  if (
    !Object.hasOwn(body, "expectedVersion") ||
    !Object.hasOwn(body, "status") ||
    !Object.hasOwn(body, "eventSelections") ||
    !Object.hasOwn(body, "attendees") ||
    !Object.hasOwn(body, "overrideReason")
  ) {
    validationError();
  }

  return {
    attendees: normalizeRsvpAttendees(body.attendees),
    dietaryNotes:
      body.dietaryNotes === undefined
        ? undefined
        : normalizeNullableText(body.dietaryNotes),
    eventSelections: normalizeRsvpEventSelections(body.eventSelections),
    expectedVersion: normalizeExpectedVersion(body.expectedVersion),
    overrideReason: normalizeOverrideReason(body.overrideReason),
    status: normalizeRsvpStatus(body.status),
  };
}

function normalizeGuestMessageUpdateInput(
  body: unknown,
): NormalizedGuestMessageUpdateInput {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, UPDATE_GUEST_MESSAGE_FIELDS);

  if (!Object.hasOwn(body, "isHidden")) {
    validationError();
  }

  return { isHidden: normalizeBoolean(body.isHidden) };
}

function normalizeInviteeInput(body: unknown): NormalizedInviteeInput {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, INVITEE_FIELDS);

  if (
    body.category !== InviteeCategory.ADULT &&
    body.category !== InviteeCategory.CHILD
  ) {
    validationError();
  }

  return {
    category: body.category,
    fullName: normalizeRequiredText(body.fullName),
    label: normalizeNullableText(body.label),
  };
}

function normalizeInvitees(value: unknown): NormalizedInviteeInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    validationError();
  }

  return value.map((item) => {
    if (!isPlainObject(item)) {
      validationError();
    }

    return normalizeInviteeInput(item);
  });
}

export function normalizeAdminCreateInvitationInput(
  body: unknown,
): NormalizedCreateInput {
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

  assertKnownKeys(
    body,
    new Set(["expectedUpdatedAt", ...WRITABLE_UPDATE_FIELDS]),
  );

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

function normalizeInviteeUpdateInput(
  body: unknown,
): NormalizedInviteeUpdateInput {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, UPDATE_INVITEE_FIELDS);

  if (!Object.hasOwn(body, "expectedUpdatedAt")) {
    validationError();
  }

  const values: NormalizedInviteeUpdateInput["values"] = {};

  if (Object.hasOwn(body, "fullName")) {
    values.fullName = normalizeRequiredText(body.fullName);
  }

  if (Object.hasOwn(body, "category")) {
    if (
      body.category !== InviteeCategory.ADULT &&
      body.category !== InviteeCategory.CHILD
    ) {
      validationError();
    }

    values.category = body.category;
  }

  if (Object.hasOwn(body, "label")) {
    values.label = normalizeNullableText(body.label);
  }

  if (Object.keys(values).length === 0) {
    validationError();
  }

  return {
    expectedUpdatedAt: normalizeRequiredDate(body.expectedUpdatedAt),
    values,
  };
}

function normalizeReplaceEventsInput(body: unknown): string[] {
  if (!isPlainObject(body)) {
    validationError();
  }

  assertKnownKeys(body, REPLACE_EVENTS_FIELDS);

  if (!Object.hasOwn(body, "eventIds")) {
    validationError();
  }

  return normalizeReplacementEventIds(body.eventIds);
}

function nextMonotonicTimestamp(current: Date): Date {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

function mapInviteeMutation(row: InviteeMutationRow): AdminInviteeMutationDto {
  return {
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    displayOrder: row.displayOrder,
    fullName: row.fullName,
    id: row.id,
    invitationId: row.invitationId,
    label: row.label,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapAdminGuestMessageItem(row: {
  authorName: string | null;
  createdAt: Date;
  id: string;
  invitation: {
    displayName: string;
    id: string;
  };
  isHidden: boolean;
  message: string;
}): AdminGuestMessageItemDto {
  return {
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    invitation: {
      displayName: row.invitation.displayName,
      id: row.invitation.id,
    },
    isHidden: row.isHidden,
    message: row.message,
  };
}

function isPrismaKnownErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
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
    @Inject(PublicRsvpService)
    private readonly publicRsvpService: PublicRsvpService,
  ) {}

  async createInvitation(
    body: unknown,
  ): Promise<CreateAdminInvitationResponseDto> {
    const input = normalizeAdminCreateInvitationInput(body);
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
      publicUrl: this.publicBaseUrlService.buildInvitationUrl(
        result.credential,
      ),
    };
  }

  async createInvitee(
    invitationId: string,
    body: unknown,
  ): Promise<AdminInviteeMutationDto> {
    assertUuid(invitationId);
    const input = normalizeInviteeInput(body);

    const invitee = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.lockInvitation(tx, invitationId);
      this.assertInvitationActive(invitation);

      const maxOrder = await tx.invitee.aggregate({
        _max: { displayOrder: true },
        where: { invitationId: invitation.id },
      });

      return tx.invitee.create({
        data: {
          category: input.category,
          displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
          fullName: input.fullName,
          invitationId: invitation.id,
          label: input.label,
        },
        select: this.inviteeMutationSelect(),
      });
    });

    return mapInviteeMutation(invitee);
  }

  async updateInvitee(
    inviteeId: string,
    body: unknown,
  ): Promise<AdminInviteeMutationDto> {
    assertUuid(inviteeId);
    const input = normalizeInviteeUpdateInput(body);

    const invitee = await this.prisma.$transaction(async (tx) => {
      const owner = await tx.invitee.findUnique({
        select: { invitationId: true },
        where: { id: inviteeId },
      });

      if (owner === null) {
        notFound();
      }

      const invitation = await this.lockInvitation(tx, owner.invitationId);
      this.assertInvitationActive(invitation);

      const current = await tx.invitee.findUnique({
        select: this.inviteeMutationSelect(),
        where: { id: inviteeId },
      });

      if (current === null || current.invitationId !== invitation.id) {
        notFound();
      }

      if (
        current.updatedAt.toISOString() !==
        input.expectedUpdatedAt.toISOString()
      ) {
        conflict("Invitee has changed.");
      }

      return tx.invitee.update({
        data: {
          ...input.values,
          updatedAt: nextMonotonicTimestamp(current.updatedAt),
        },
        select: this.inviteeMutationSelect(),
        where: { id: current.id },
      });
    });

    return mapInviteeMutation(invitee);
  }

  async deleteInvitee(inviteeId: string): Promise<void> {
    assertUuid(inviteeId);

    await this.prisma.$transaction(async (tx) => {
      const owner = await tx.invitee.findUnique({
        select: { invitationId: true },
        where: { id: inviteeId },
      });

      if (owner === null) {
        return;
      }

      const invitation = await this.lockInvitation(tx, owner.invitationId);
      this.assertInvitationActive(invitation);

      const current = await tx.invitee.findUnique({
        select: { id: true, invitationId: true },
        where: { id: inviteeId },
      });

      if (current === null || current.invitationId !== invitation.id) {
        return;
      }

      const referenceCount = await tx.rSVPAttendee.count({
        where: { inviteeId: current.id },
      });

      if (referenceCount > 0) {
        conflict("Invitee is referenced by an RSVP.");
      }

      try {
        await tx.invitee.delete({ where: { id: current.id } });
      } catch (error) {
        if (isPrismaKnownErrorCode(error, "P2003")) {
          conflict("Invitee is referenced by an RSVP.");
        }

        throw error;
      }
    });
  }

  async replaceInvitationEvents(
    invitationId: string,
    body: unknown,
  ): Promise<ReplaceAdminInvitationEventsResponseDto> {
    assertUuid(invitationId);
    const desiredEventIds = normalizeReplaceEventsInput(body);

    const eligibility = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.lockInvitation(tx, invitationId);
      this.assertInvitationActive(invitation);

      const currentRows = await tx.invitationEvent.findMany({
        select: {
          event: {
            select: {
              displayOrder: true,
              id: true,
              isActive: true,
              name: true,
              slug: true,
            },
          },
          eventId: true,
        },
        where: { invitationId: invitation.id },
      });
      const currentEventIds = new Set(currentRows.map((row) => row.eventId));
      const desiredEventIdSet = new Set(desiredEventIds);
      const events = await tx.event.findMany({
        select: {
          displayOrder: true,
          id: true,
          isActive: true,
          name: true,
          slug: true,
        },
        where: { id: { in: desiredEventIds } },
      });

      if (events.length !== desiredEventIds.length) {
        validationError();
      }

      if (
        events.some(
          (event) => !event.isActive && !currentEventIds.has(event.id),
        )
      ) {
        validationError();
      }

      const removedEventIds = [...currentEventIds].filter(
        (eventId) => !desiredEventIdSet.has(eventId),
      );
      const addedEventIds = desiredEventIds.filter(
        (eventId) => !currentEventIds.has(eventId),
      );

      if (removedEventIds.length > 0) {
        const referenced = await tx.rSVPEventSelection.count({
          where: {
            eventId: { in: removedEventIds },
            rsvp: { invitationId: invitation.id },
          },
        });

        if (referenced > 0) {
          conflict("Eligibility removal is referenced by an RSVP.");
        }
      }

      if (removedEventIds.length > 0) {
        await tx.invitationEvent.deleteMany({
          where: {
            eventId: { in: removedEventIds },
            invitationId: invitation.id,
          },
        });
      }

      if (addedEventIds.length > 0) {
        await tx.invitationEvent.createMany({
          data: addedEventIds.map((eventId) => ({
            eventId,
            invitationId: invitation.id,
          })),
        });
      }

      const resultingRows = await tx.invitationEvent.findMany({
        orderBy: [{ event: { displayOrder: "asc" } }, { event: { id: "asc" } }],
        select: {
          event: {
            select: {
              displayOrder: true,
              id: true,
              isActive: true,
              name: true,
              slug: true,
            },
          },
        },
        where: { invitationId: invitation.id },
      });

      return resultingRows.map((row) => ({ event: row.event }));
    });

    return { eligibility };
  }

  async overrideRsvp(
    invitationId: string,
    body: unknown,
    adminUserId: string,
  ): Promise<AdminRsvpDetailResponseDto> {
    assertUuid(invitationId);
    assertUuid(adminUserId);
    const input = normalizeAdminRsvpOverrideInput(body);
    const { rsvpId } = await this.publicRsvpService.submitAdminRsvpOverride({
      ...input,
      invitationId,
      submittedByAdminUserId: adminUserId,
    });

    return this.adminReadService.getRsvpDetail(rsvpId);
  }

  async updateGuestMessageVisibility(
    messageId: string,
    body: unknown,
  ): Promise<AdminGuestMessageItemDto> {
    assertUuid(messageId);
    const input = normalizeGuestMessageUpdateInput(body);

    const result = await this.prisma.guestMessage.updateMany({
      data: { isHidden: input.isHidden },
      where: { id: messageId },
    });

    if (result.count === 0) {
      notFound();
    }

    const message = await this.prisma.guestMessage.findUnique({
      select: {
        authorName: true,
        createdAt: true,
        id: true,
        invitation: {
          select: {
            displayName: true,
            id: true,
          },
        },
        isHidden: true,
        message: true,
      },
      where: { id: messageId },
    });

    if (message === null) {
      notFound();
    }

    return mapAdminGuestMessageItem(message);
  }

  private async assertActiveEvents(
    tx: Prisma.TransactionClient,
    eventIds: readonly string[],
  ): Promise<void> {
    const events = await tx.event.findMany({
      select: { id: true, isActive: true },
      where: { id: { in: [...eventIds] } },
    });

    if (
      events.length !== eventIds.length ||
      events.some((event) => !event.isActive)
    ) {
      validationError();
    }
  }

  private inviteeMutationSelect() {
    return {
      category: true,
      createdAt: true,
      displayOrder: true,
      fullName: true,
      id: true,
      invitationId: true,
      label: true,
      updatedAt: true,
    } satisfies Prisma.InviteeSelect;
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
