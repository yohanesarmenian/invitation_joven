/* eslint-disable no-console */
const {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const apiRoot = path.join(repoRoot, "apps", "api");
const apiNodeModules = path.join(apiRoot, "node_modules");
const { Client } = require(path.join(apiNodeModules, "pg"));
const { Algorithm, hash } = require(
  path.join(apiNodeModules, "@node-rs", "argon2"),
);
const ExcelJS = require(path.join(apiNodeModules, "exceljs"));

const ARGON2ID_PARAMETERS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  parallelism: 1,
  timeCost: 2,
};
const CSRF_CONTEXT = "admin-csrf-v1";

function loadEnv() {
  const envPath = path.join(apiRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function databaseUrl() {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for live import QA.");
  }
  const url = new URL(process.env.DATABASE_URL);
  const localHost = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  const disposableName = /(?:test|smoke|local|dev)/i.test(
    url.pathname.replace(/^\//, ""),
  );
  const explicitQa =
    process.env.INVITATION_WORKFLOW_TEST === "1" &&
    /^invitation_(ci|qa_[a-z0-9_]+)$/.test(url.pathname.slice(1));
  if (!localHost || !(disposableName || explicitQa)) {
    throw new Error(
      `Refusing live import QA against non-disposable database ${url.hostname}/${url.pathname.slice(1)}.`,
    );
  }
  return process.env.DATABASE_URL;
}

function marker(runId) {
  return `phase9e_${runId.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`;
}

function displayPrefix(runId) {
  return `Phase9E ${runId}`;
}

function slug(runId, name) {
  return `phase9e-${runId.toLowerCase()}-${name}`;
}

function sessionTokens() {
  const rawSessionTokenBytes = randomBytes(32);
  const sessionToken = rawSessionTokenBytes.toString("base64url");
  const csrfToken = createHmac("sha256", rawSessionTokenBytes)
    .update(CSRF_CONTEXT, "utf8")
    .digest("base64url");
  return {
    csrfToken,
    csrfTokenHash: createHash("sha256").update(csrfToken, "utf8").digest("hex"),
    sessionToken,
    sessionTokenHash: createHash("sha256")
      .update(rawSessionTokenBytes)
      .digest("hex"),
  };
}

async function withClient(fn) {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanup(client, runId) {
  const prefix = `${displayPrefix(runId)}%`;
  const slugPrefix = `phase9e-${runId.toLowerCase()}-%`;
  const email = `${marker(runId)}@example.test`;
  await client.query("BEGIN");
  try {
    const invitations = await client.query(
      `SELECT "id" FROM "invitations"
       WHERE "display_name" LIKE $1 OR "public_token_hash" LIKE $2`,
      [prefix, `${marker(runId)}%`],
    );
    const invitationIds = invitations.rows.map((row) => row.id);
    const admins = await client.query(
      `SELECT "id" FROM "admin_users" WHERE "email" = $1`,
      [email],
    );
    const adminIds = admins.rows.map((row) => row.id);

    if (adminIds.length > 0) {
      await client.query(
        `DELETE FROM "guest_import_previews"
         WHERE "created_by_admin_user_id" = ANY($1::uuid[])`,
        [adminIds],
      );
      await client.query(
        `DELETE FROM "guest_import_batches"
         WHERE "committed_by_admin_user_id" = ANY($1::uuid[])`,
        [adminIds],
      );
      await client.query(
        `DELETE FROM "admin_sessions"
         WHERE "admin_user_id" = ANY($1::uuid[])`,
        [adminIds],
      );
    }

    if (invitationIds.length > 0) {
      await client.query(
        `DELETE FROM "checkin_records"
         WHERE "invitation_id" = ANY($1::uuid[])`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "checkin_passes"
         WHERE "invitation_id" = ANY($1::uuid[])`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "rsvp_event_selections"
         WHERE "rsvp_id" IN (
           SELECT "id" FROM "rsvps" WHERE "invitation_id" = ANY($1::uuid[])
         )`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "rsvp_attendees"
         WHERE "rsvp_id" IN (
           SELECT "id" FROM "rsvps" WHERE "invitation_id" = ANY($1::uuid[])
         )`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "rsvps" WHERE "invitation_id" = ANY($1::uuid[])`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "guest_messages"
         WHERE "invitation_id" = ANY($1::uuid[])`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "invitation_events"
         WHERE "invitation_id" = ANY($1::uuid[])`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "invitees" WHERE "invitation_id" = ANY($1::uuid[])`,
        [invitationIds],
      );
      await client.query(
        `DELETE FROM "invitations" WHERE "id" = ANY($1::uuid[])`,
        [invitationIds],
      );
    }

    await client.query(`DELETE FROM "events" WHERE "slug" LIKE $1`, [
      slugPrefix,
    ]);
    await client.query(`DELETE FROM "admin_users" WHERE "email" = $1`, [email]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function setup(runId) {
  return withClient(async (client) => {
    await cleanup(client, runId);
    const ownerId = randomUUID();
    const password = `Phase9e ${runId} synthetic password`;
    const email = `${marker(runId)}@example.test`;
    const passwordHash = await hash(password, ARGON2ID_PARAMETERS);
    const tokens = sessionTokens();
    const now = new Date();
    const maxDisplayOrder = await client.query(
      `SELECT COALESCE(MAX("display_order"), 0)::int AS "value" FROM "events"`,
    );
    const baseDisplayOrder = Number(maxDisplayOrder.rows[0].value) + 100;
    const ceremonySlug = slug(runId, "ceremony");
    const receptionSlug = slug(runId, "reception");
    const inactiveSlug = slug(runId, "inactive");
    const duplicateName = `${displayPrefix(runId)} Duplicate Household`;

    await client.query(
      `INSERT INTO "admin_users"
       ("id", "email", "password_hash", "role", "status", "updated_at")
       VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', $4)`,
      [ownerId, email, passwordHash, now],
    );
    await client.query(
      `INSERT INTO "admin_sessions"
       ("id", "admin_user_id", "session_token_hash", "csrf_token_hash", "expires_at")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        ownerId,
        tokens.sessionTokenHash,
        tokens.csrfTokenHash,
        new Date(Date.now() + 12 * 60 * 60 * 1000),
      ],
    );
    for (const [index, event] of [
      [0, { active: true, name: "Ceremony", slug: ceremonySlug }],
      [1, { active: true, name: "Reception", slug: receptionSlug }],
      [2, { active: false, name: "Inactive", slug: inactiveSlug }],
    ]) {
      await client.query(
        `INSERT INTO "events"
         ("id", "slug", "name", "display_order", "is_active", "updated_at")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          event.slug,
          `${displayPrefix(runId)} ${event.name}`,
          baseDisplayOrder + index,
          event.active,
          now,
        ],
      );
    }
    await client.query(
      `INSERT INTO "invitations"
       ("id", "display_name", "public_token_hash", "public_token_version",
        "status", "updated_at")
       VALUES ($1, $2, $3, 1, 'ACTIVE', $4)`,
      [
        randomUUID(),
        duplicateName,
        `${marker(runId)}_duplicate_${randomUUID()}`,
        now,
      ],
    );

    return {
      adminOrigin: process.env.ADMIN_ORIGIN ?? "http://localhost:3001",
      ceremonySlug,
      database: {
        database: new URL(databaseUrl()).pathname.slice(1),
        host: new URL(databaseUrl()).hostname,
        port: new URL(databaseUrl()).port,
      },
      duplicateName,
      email,
      inactiveSlug,
      password,
      receptionSlug,
      runId,
      sessionCookie: `admin_session=${tokens.sessionToken}`,
    };
  });
}

async function counts(client) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM "invitations") AS "invitations",
       (SELECT COUNT(*)::int FROM "invitees") AS "invitees",
       (SELECT COUNT(*)::int FROM "invitation_events") AS "invitationEvents",
       (SELECT COUNT(*)::int FROM "rsvps") AS "rsvps",
       (SELECT COUNT(*)::int FROM "rsvp_attendees") AS "rsvpAttendees",
       (SELECT COUNT(*)::int FROM "rsvp_event_selections") AS "rsvpEventSelections",
       (SELECT COUNT(*)::int FROM "guest_messages") AS "guestMessages",
       (SELECT COUNT(*)::int FROM "checkin_passes") AS "checkinPasses",
       (SELECT COUNT(*)::int FROM "checkin_records") AS "checkinRecords",
       (SELECT COUNT(*)::int FROM "guest_import_batches") AS "guestImportBatches",
       (SELECT COUNT(*)::int FROM "guest_import_previews") AS "guestImportPreviews"`,
  );
  return result.rows[0];
}

async function snapshot(runId) {
  return withClient(async (client) => {
    const email = `${marker(runId)}@example.test`;
    const prefix = `${displayPrefix(runId)}%`;
    const scoped = await client.query(
      `SELECT
         "i"."id",
         "i"."display_name" AS "displayName",
         "i"."greeting_name" AS "greetingName",
         "i"."rsvp_deadline_at" AS "rsvpDeadlineAt",
         "i"."allow_plus_one" AS "allowPlusOne",
         "i"."max_additional_children" AS "maxAdditionalChildren",
         "i"."notes",
         "i"."status",
         ("i"."public_token_hash" IS NOT NULL) AS "hasPublicTokenHash",
         COALESCE((
           SELECT json_agg(
             json_build_object(
               'fullName', "iv"."full_name",
               'category', "iv"."category",
               'label', "iv"."label",
               'displayOrder', "iv"."display_order"
             )
             ORDER BY "iv"."display_order" ASC
           )
           FROM "invitees" "iv"
           WHERE "iv"."invitation_id" = "i"."id"
         ), '[]'::json) AS "invitees",
         COALESCE((
           SELECT json_agg(
             json_build_object(
               'slug', "e"."slug",
               'isActive', "e"."is_active",
               'displayOrder', "e"."display_order"
             )
             ORDER BY "e"."display_order" ASC
           )
           FROM "invitation_events" "ie"
           INNER JOIN "events" "e" ON "e"."id" = "ie"."event_id"
           WHERE "ie"."invitation_id" = "i"."id"
         ), '[]'::json) AS "events",
         (SELECT COUNT(*)::int FROM "rsvps" "r" WHERE "r"."invitation_id" = "i"."id") AS "rsvpCount"
       FROM "invitations" "i"
       WHERE "i"."display_name" LIKE $1
       ORDER BY "i"."display_name" ASC, "i"."created_at" ASC, "i"."id" ASC`,
      [prefix],
    );
    const importRows = await client.query(
      `SELECT
         "p"."id" AS "previewId",
         "p"."status" AS "previewStatus",
         "p"."commit_fingerprint" IS NOT NULL AS "hasCommitFingerprint",
         "p"."committed_batch_id" AS "committedBatchId",
         "b"."id" AS "batchId",
         "b"."created_invitation_count" AS "createdInvitationCount",
         "b"."created_invitee_count" AS "createdInviteeCount",
         "b"."warning_count" AS "warningCount",
         "b"."source_format" AS "sourceFormat"
       FROM "guest_import_previews" "p"
       LEFT JOIN "guest_import_batches" "b" ON "b"."id" = "p"."committed_batch_id"
       INNER JOIN "admin_users" "u" ON "u"."id" = "p"."created_by_admin_user_id"
       WHERE "u"."email" = $1
       ORDER BY "p"."created_at" ASC, "p"."id" ASC`,
      [email],
    );

    return {
      counts: await counts(client),
      imports: importRows.rows,
      scopedInvitations: scoped.rows,
    };
  });
}

async function xlsx(runId, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Invitations");
  sheet.addRow([
    "displayName",
    "greetingName",
    "allowPlusOne",
    "maxAdditionalChildren",
    "rsvpDeadlineLocal",
    "notes",
    "invitees",
    `event:${slug(runId, "ceremony")}`,
    `event:${slug(runId, "reception")}`,
  ]);
  sheet.addRow([
    `${displayPrefix(runId)} XLSX Household`,
    "XLSX Guests",
    false,
    1,
    "2027-01-16 18:30",
    "XLSX synthetic note",
    JSON.stringify([{ category: "ADULT", fullName: "XLSX Adult" }]),
    false,
    true,
  ]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  return { outputPath };
}

async function main() {
  const [command, runId, outputPath] = process.argv.slice(2);
  if (!command || !runId) {
    throw new Error(
      "Usage: live-import-db.cjs <setup|snapshot|cleanup|xlsx> <runId> [outputPath]",
    );
  }
  const result =
    command === "setup"
      ? await setup(runId)
      : command === "snapshot"
        ? await snapshot(runId)
        : command === "cleanup"
          ? await withClient(async (client) => {
              await cleanup(client, runId);
              return { cleaned: true };
            })
          : command === "xlsx"
            ? await xlsx(runId, outputPath)
            : null;
  if (result === null) {
    throw new Error(`Unknown command: ${command}`);
  }
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
