import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { nativeCompose } from "./render-compose.mjs";

test("native verification retains the Coolify stack except its documented health exclusion", async () => {
  const source = await readFile(
    new URL("../../compose.coolify.yaml", import.meta.url),
    "utf8",
  );
  const expected = parse(source);
  delete expected.services.migrate.exclude_from_hc;
  const result = parse(nativeCompose(source));
  assert.deepEqual(result, expected);
  assert.ok(Object.values(result.services).every((service) => !service.ports));
  assert.equal(
    result.services.api.depends_on.migrate.condition,
    "service_completed_successfully",
  );
  assert.ok(
    result.services.api.environment.CREDENTIAL_SECRET.includes(
      "${CREDENTIAL_SECRET:?",
    ),
  );
});
test("duplicate keys and missing health exclusion refuse native rendering", () => {
  assert.throws(() => nativeCompose("services: {}"), /explicit Coolify/);
  assert.throws(() => nativeCompose("services: {}\nservices: {}"));
});
