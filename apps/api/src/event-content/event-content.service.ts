import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type EventContent } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { CredentialService } from "../security/credential.service.js";
import { validatePublicCredential } from "../invitations/public-invitation.service.js";
import { conflict, notFound, validationError } from "../auth/auth-errors.js";
import {
  assetIds,
  EMPTY_VENUE_CONTENT,
  parseSave,
  parseVenueBody,
  parseVersionOnly,
  UUID,
} from "./event-content.validation.js";
import { normalizeVenueUpload } from "./event-content-upload.js";
import type {
  AdminEventContentDto,
  EventVenueBodyDto,
  PublicEventContentDto,
} from "./event-content.dto.js";

type Tx = Prisma.TransactionClient;
function id(value: string) {
  if (!UUID.test(value)) validationError();
  return value.toLowerCase();
}
function json(body: EventVenueBodyDto): Prisma.InputJsonValue {
  return body as unknown as Prisma.InputJsonValue;
}
function published(row: EventContent | null) {
  return row?.published == null ? null : parseVenueBody(row.published, true);
}
function unavailable(): never {
  throw new NotFoundException({
    code: "INVITATION_NOT_AVAILABLE",
    details: null,
    message: "Invitation not available",
  });
}

@Injectable()
export class EventContentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService) private readonly credentials: CredentialService,
  ) {}

  private async state(tx: Tx, eventId: string): Promise<AdminEventContentDto> {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { name: true },
    });
    if (!event) notFound();
    const row = await tx.eventContent.findUnique({ where: { eventId } });
    const draft = row ? parseVenueBody(row.draft) : EMPTY_VENUE_CONTENT;
    const snapshot = published(row);
    const draftIds = assetIds(draft),
      publishedIds = assetIds(snapshot);
    const assets = await tx.eventContentAsset.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, mimeType: true, byteSize: true },
    });
    return {
      eventId,
      eventName: event.name,
      version: row?.version ?? 0,
      draft,
      published: snapshot,
      publishedAt: row?.publishedAt?.toISOString() ?? null,
      assets: assets.map((asset) => ({
        ...asset,
        kind: asset.kind as "IMAGE" | "PDF",
        mimeType: asset.mimeType as "image/png" | "application/pdf",
        usedByDraft: draftIds.includes(asset.id),
        usedByPublished: publishedIds.includes(asset.id),
      })),
    };
  }
  async read(eventId: string) {
    return this.prisma.$transaction((tx) => this.state(tx, id(eventId)), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
  private async mutate(
    eventId: string,
    version: number,
    action: (tx: Tx, row: EventContent | null) => Promise<void>,
  ) {
    eventId = id(eventId);
    return this.prisma.$transaction(async (tx) => {
      const events = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
      if (events.length !== 1) notFound();
      const row = await tx.eventContent.findUnique({ where: { eventId } });
      if ((row?.version ?? 0) !== version) conflict();
      if (!row)
        await tx.eventContent.create({
          data: { eventId, version: 1, draft: json(EMPTY_VENUE_CONTENT) },
        });
      await action(tx, row);
      if (row)
        await tx.eventContent.update({
          where: { eventId },
          data: { version: { increment: 1 } },
        });
      return this.state(tx, eventId);
    });
  }
  private async references(tx: Tx, eventId: string, body: EventVenueBodyDto) {
    const ids = assetIds(body);
    const assets = await tx.eventContentAsset.findMany({
      where: { eventId, id: { in: ids } },
      select: { id: true, kind: true },
    });
    for (const [assetId, kind] of [
      [body.parking?.mapAssetId, "IMAGE"],
      [body.parking?.pdfAssetId, "PDF"],
    ] as const) {
      if (
        assetId &&
        !assets.some(
          (asset) => asset.id === assetId.toLowerCase() && asset.kind === kind,
        )
      )
        validationError();
    }
  }
  async save(eventId: string, input: unknown) {
    const { version, content } = parseSave(input);
    const normalized = structuredClone(content);
    if (normalized.parking) {
      normalized.parking.mapAssetId =
        normalized.parking.mapAssetId?.toLowerCase() ?? null;
      normalized.parking.pdfAssetId =
        normalized.parking.pdfAssetId?.toLowerCase() ?? null;
    }
    return this.mutate(eventId, version, async (tx) => {
      await this.references(tx, id(eventId), normalized);
      await tx.eventContent.update({
        where: { eventId: id(eventId) },
        data: { draft: json(normalized) },
      });
    });
  }
  async publish(eventId: string, input: unknown) {
    return this.mutate(eventId, parseVersionOnly(input), async (tx, row) => {
      const body = parseVenueBody(row?.draft ?? EMPTY_VENUE_CONTENT, true);
      const event = await tx.event.findUnique({
        where: { id: id(eventId) },
        select: { isActive: true },
      });
      if (!event?.isActive) conflict();
      await this.references(tx, id(eventId), body);
      await tx.eventContent.update({
        where: { eventId: id(eventId) },
        data: { published: json(body), publishedAt: new Date() },
      });
    });
  }
  async hide(eventId: string, input: unknown) {
    return this.mutate(eventId, parseVersionOnly(input), async (tx, row) => {
      if (row)
        await tx.eventContent.update({
          where: { eventId: id(eventId) },
          data: { published: Prisma.DbNull, publishedAt: null },
        });
    });
  }
  async upload(
    eventId: string,
    version: number,
    source: { buffer: Buffer; filename: string; mimetype: string },
  ) {
    const asset = await normalizeVenueUpload(source);
    return this.mutate(eventId, version, async (tx) => {
      if (
        (await tx.eventContentAsset.count({
          where: { eventId: id(eventId) },
        })) >= 8
      )
        conflict();
      await tx.eventContentAsset.create({
        data: {
          eventId: id(eventId),
          kind: asset.kind,
          mimeType: asset.mimeType,
          byteSize: asset.bytes.length,
          bytes: new Uint8Array(asset.bytes),
        },
      });
    });
  }
  async removeAsset(eventId: string, assetId: string, input: unknown) {
    assetId = id(assetId);
    return this.mutate(eventId, parseVersionOnly(input), async (tx, row) => {
      if (
        assetIds(row ? parseVenueBody(row.draft) : null).includes(assetId) ||
        assetIds(published(row)).includes(assetId)
      )
        conflict();
      if (
        (
          await tx.eventContentAsset.deleteMany({
            where: { id: assetId, eventId: id(eventId) },
          })
        ).count !== 1
      )
        notFound();
    });
  }
  async adminAsset(eventId: string, assetId: string) {
    const asset = await this.prisma.eventContentAsset.findFirst({
      where: { id: id(assetId), eventId: id(eventId) },
      select: { bytes: true, kind: true, mimeType: true },
    });
    if (!asset) notFound();
    return asset;
  }
  private async eligible(tx: Tx, publicCredential: string) {
    let hash: string;
    try {
      hash = this.credentials.hashCredential(
        validatePublicCredential(publicCredential),
      );
    } catch {
      unavailable();
    }
    const invitation = await tx.invitation.findUnique({
      where: { publicTokenHash: hash },
      select: { id: true, status: true },
    });
    if (!invitation || invitation.status !== "ACTIVE") unavailable();
    return tx.eventContent.findMany({
      where: {
        published: { not: Prisma.DbNull },
        event: {
          isActive: true,
          invitationEvents: { some: { invitationId: invitation.id } },
        },
      },
      orderBy: { event: { displayOrder: "asc" } },
      select: {
        eventId: true,
        published: true,
        event: { select: { name: true } },
      },
    });
  }
  async publicContent(
    publicCredential: string,
  ): Promise<PublicEventContentDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await this.eligible(tx, publicCredential);
        return {
          items: rows.map((row) => ({
            eventId: row.eventId,
            eventName: row.event.name,
            content: parseVenueBody(row.published, true),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async publicAsset(publicCredential: string, assetId: string) {
    if (!UUID.test(assetId)) unavailable();
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await this.eligible(tx, publicCredential);
        const owner = rows.find((row) =>
          assetIds(parseVenueBody(row.published, true)).includes(
            assetId.toLowerCase(),
          ),
        );
        if (!owner) unavailable();
        const asset = await tx.eventContentAsset.findFirst({
          where: { id: assetId.toLowerCase(), eventId: owner.eventId },
          select: { bytes: true, kind: true, mimeType: true },
        });
        if (!asset) unavailable();
        return asset;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
