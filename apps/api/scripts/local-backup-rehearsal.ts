import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import sharp from "sharp";
import { createWorkflowFixture } from "./admin-workflow-fixture.js";

async function main() {
  // The fixture rejects the operation before writes unless QA DB + flag match.
  const fixture = await createWorkflowFixture();
  const url = new URL(process.env.DATABASE_URL!),
    target = `invitation_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  if (!/^invitation_restore_[a-f0-9]{12}$/.test(target))
    throw new Error("Invalid restore database name");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() }),
    restoreUrl = new URL(url);
  restoreUrl.pathname = `/${target}`;
  const restored = new Client({ connectionString: restoreUrl.toString() });
  const directory = mkdtempSync(join(tmpdir(), "invitation-qa-restore-")),
    dump = join(directory, "synthetic.dump");
  let created = false,
    connected = false;
  try {
    const household = await fixture.household("Synthetic backup rehearsal");
    const media = await sharp({
      create: { width: 4, height: 2, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const asset = await fixture.prisma.eventContentAsset.create({
      data: {
        eventId: fixture.event.id,
        kind: "IMAGE",
        mimeType: "image/png",
        byteSize: media.length,
        bytes: new Uint8Array(media),
      },
    });
    const venue = {
      parking: {
        title: "Synthetic backup parking",
        instructions: ["Synthetic instruction"],
        mapAssetId: asset.id,
        mapAlt: "Synthetic map",
        pdfAssetId: null,
        googleMapsUrl: null,
      },
      rundown: null,
    };
    await fixture.prisma.eventContent.create({
      data: {
        eventId: fixture.event.id,
        version: 2,
        draft: venue,
        published: venue,
        publishedAt: new Date(),
      },
    });
    await fixture.prisma.checkinRecord.create({
      data: {
        invitationId: household.id,
        eventId: fixture.event.id,
        confirmedByAdminUserId: fixture.staff.id,
        method: "MANUAL",
        attendeeCount: 1,
      },
    });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${target}"`);
    created = true;
    const common = [
        "--host",
        url.hostname,
        "--port",
        url.port || "5432",
        "--username",
        decodeURIComponent(url.username),
      ],
      env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
    const dumpResult = spawnSync(
      process.env.PG_DUMP_NODE_WRAPPER
        ? process.execPath
        : (process.env.PG_DUMP_BIN ?? "pg_dump"),
      [
        ...(process.env.PG_DUMP_NODE_WRAPPER
          ? [process.env.PG_DUMP_NODE_WRAPPER]
          : []),
        ...common,
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--file",
        dump,
        url.pathname.slice(1),
      ],
      { env, encoding: "utf8" },
    );
    if (dumpResult.error || dumpResult.status !== 0)
      throw new Error("pg_dump failed; diagnostic contents omitted");
    const restoreResult = spawnSync(
      process.env.PG_RESTORE_NODE_WRAPPER
        ? process.execPath
        : (process.env.PG_RESTORE_BIN ?? "pg_restore"),
      [
        ...(process.env.PG_RESTORE_NODE_WRAPPER
          ? [process.env.PG_RESTORE_NODE_WRAPPER]
          : []),
        ...common,
        "--dbname",
        target,
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
        dump,
      ],
      { env, encoding: "utf8" },
    );
    if (restoreResult.error || restoreResult.status !== 0)
      throw new Error("pg_restore failed; diagnostic contents omitted");
    await restored.connect();
    connected = true;
    const state = (
      await restored.query<{
        invitations: number;
        rsvps: number;
        passes: number;
        records: number;
        correctOperator: number;
        migrations: number;
        venueContent: number;
        matchingAsset: number;
      }>(
        `
      SELECT (SELECT COUNT(*)::int FROM invitations WHERE id=$1::uuid) AS invitations,
        (SELECT COUNT(*)::int FROM rsvps WHERE invitation_id=$1::uuid) AS rsvps,
        (SELECT COUNT(*)::int FROM checkin_passes WHERE invitation_id=$1::uuid) AS passes,
        (SELECT COUNT(*)::int FROM checkin_records WHERE invitation_id=$1::uuid AND event_id=$2::uuid) AS records,
        (SELECT COUNT(*)::int FROM checkin_records WHERE invitation_id=$1::uuid AND confirmed_by_admin_user_id=$3::uuid AND attendee_count=1 AND method='MANUAL') AS "correctOperator",
        (SELECT COUNT(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL) AS migrations,
        (SELECT COUNT(*)::int FROM event_contents WHERE event_id=$2::uuid AND version=2 AND draft=published AND published->'parking'->>'mapAssetId'=$4::text) AS "venueContent",
        (SELECT COUNT(*)::int FROM event_content_assets WHERE id=$4::uuid AND event_id=$2::uuid AND bytes=$5::bytea AND byte_size=octet_length($5::bytea) AND mime_type='image/png') AS "matchingAsset"
    `,
        [household.id, fixture.event.id, fixture.staff.id, asset.id, media],
      )
    ).rows[0];
    if (
      !state ||
      state.invitations !== 1 ||
      state.rsvps !== 1 ||
      state.passes !== 1 ||
      state.records !== 1 ||
      state.correctOperator !== 1 ||
      state.migrations < 4 ||
      state.venueContent !== 1 ||
      state.matchingAsset !== 1
    )
      throw new Error(
        "Restored synthetic state did not match expected counts and attribution",
      );
    process.stdout.write(
      JSON.stringify({
        status: "RESTORE_VERIFIED",
        ...state,
        credentialMaterialPrinted: false,
      }) + "\n",
    );
  } finally {
    if (connected) await restored.end();
    if (created) await admin.query(`DROP DATABASE "${target}"`);
    await admin.end();
    await fixture.cleanup();
    rmSync(dump, { force: true });
    rmdirSync(directory);
  }
}
await main();
