import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

test("production pulls images, keeps DB private and migration explicit", async () => {
  const doc = parse(
    await readFile(
      new URL("../../compose.production.yaml", import.meta.url),
      "utf8",
    ),
  );
  for (const service of Object.values(doc.services)) {
    assert.equal(service.build, undefined);
    assert.equal(service.ports, undefined);
  }
  assert.equal(doc.networks.database.internal, true);
  assert.deepEqual(doc.services.postgres.networks, ["database"]);
  assert.ok(
    doc.services.postgres.volumes.includes(
      "invitation_postgres_data:/var/lib/postgresql",
    ),
  );
  assert.deepEqual(doc.services.migrate.profiles, ["migration"]);
  assert.deepEqual(doc.services.migrate.command, [
    "node",
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
  ]);
  assert.equal(doc.services.api.environment.DATABASE_URL, "${DATABASE_URL:?}");
  assert.equal(doc.services.api.environment.MIGRATION_DATABASE_URL, undefined);
  assert.equal(doc.services.api.environment.NODE_ENV, "production");
  for (const name of ["admin-web", "invitation-web"]) {
    assert.equal(
      doc.services[name].depends_on.api.condition,
      "service_healthy",
    );
    assert.equal(doc.services[name].environment.DATABASE_URL, undefined);
  }
});
