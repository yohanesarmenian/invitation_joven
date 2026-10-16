import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  sign,
  authenticate,
  sha256,
  fileDigest,
  readSigned,
  writeSigned,
  receiptPath,
} from "./backup-storage.mjs";
import { identifier } from "./backup-snapshot.mjs";
import { streamArchive } from "./archive-stream.mjs";
async function removeOwnedTemp(directory) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("invitation-backup-"));
  await rm(directory, { recursive: true });
}
const config = { secret: randomBytes(32).toString("base64url") };
test("signed metadata detects changed data, wrong credentials and malformed envelopes", () => {
  const signed = sign({ version: 1, nested: { value: "synthetic" } }, config);
  assert.deepEqual(authenticate(signed, config), signed.payload);
  for (const value of [
    { ...signed, payload: { version: 2 } },
    { ...signed, mac: "00".repeat(32) },
    { ...signed, extra: true },
    {},
    null,
  ])
    assert.throws(() => authenticate(value, config), /mismatch/);
  assert.throws(
    () =>
      authenticate(signed, { secret: randomBytes(32).toString("base64url") }),
    /mismatch/,
  );
});
test("streaming digest binds exact bytes and size; signed publication refuses overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "invitation-backup-test-"));
  try {
    const file = join(directory, "synthetic.dump"),
      metadata = join(directory, "manifest.json");
    const bytes = Buffer.from("PGDMP synthetic\u0000bytes");
    await writeFile(file, bytes);
    assert.deepEqual(await fileDigest(file), {
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    await writeSigned(metadata, { id: randomUUID() }, config, true);
    const before = await readFile(metadata);
    await assert.rejects(
      writeSigned(metadata, { changed: true }, config, true),
    );
    assert.deepEqual(await readFile(metadata), before);
    assert.ok((await readSigned(metadata, config)).id);
  } finally {
    await removeOwnedTemp(directory);
  }
});
test("file and receipt boundaries reject symlink or caller-selected database cleanup paths", async () => {
  await assert.rejects(receiptPath("D:/Projects/invitation_joven"));
  const directory = await mkdtemp(
    join(tmpdir(), "invitation-backup-link-test-"),
  );
  try {
    await writeFile(join(directory, "target"), "synthetic");
    if (process.platform !== "win32") {
      await symlink(join(directory, "target"), join(directory, "link"));
      await assert.rejects(fileDigest(join(directory, "link")), /invalid/);
    }
    assert.equal(identifier('odd"table'), '"odd""table"');
  } finally {
    await removeOwnedTemp(directory);
  }
});
test("pre-cancelled transfer refuses before touching caller files or starting Docker", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "invitation-backup-cancel-test-"),
  );
  try {
    const file = join(directory, "existing.dump");
    await writeFile(file, "untouched synthetic bytes");
    await assert.rejects(
      streamArchive({
        container: "unowned",
        binary: "pg_dump",
        args: [],
        file,
        signal: AbortSignal.abort(),
      }),
    );
    assert.equal(await readFile(file, "utf8"), "untouched synthetic bytes");
  } finally {
    await removeOwnedTemp(directory);
  }
});
