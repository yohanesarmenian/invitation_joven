import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import {
  open,
  lstat,
  readFile,
  writeFile,
  rename,
  mkdir,
  realpath,
} from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { dailyDirectory } from "./config.mjs";
import { protectPrivatePath } from "./private-files.mjs";
export const backupRoot = resolve(dailyDirectory, "backups");
export const restoreRoot = resolve(dailyDirectory, "restores");
export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export function sign(payload, config) {
  return {
    payload,
    mac: createHmac("sha256", Buffer.from(config.secret, "base64url"))
      .update(JSON.stringify(payload))
      .digest("hex"),
  };
}
export function authenticate(value, config) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 2 ||
    !value.payload ||
    typeof value.mac !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.mac) ||
    !timingSafeEqual(
      Buffer.from(value.mac, "hex"),
      Buffer.from(sign(value.payload, config).mac, "hex"),
    )
  )
    throw Error("Daily backup signature/configuration mismatch.");
  return value.payload;
}
export async function privateDirectory(parent, id) {
  if (!UUID.test(id)) throw Error("Daily invalid backup/restore identity.");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await lstat(parent)).isSymbolicLink())
    throw Error("Daily private directory must not be a link.");
  await protectPrivatePath(parent, true);
  const directory = join(await realpath(parent), id);
  await mkdir(directory, { mode: 0o700 });
  await protectPrivatePath(directory, true);
  return directory;
}
export async function regularFile(path, maxSize = Infinity) {
  const value = await lstat(path);
  if (!value.isFile() || value.isSymbolicLink() || value.size > maxSize)
    throw Error("Daily backup file type/size invalid.");
  return value;
}
export async function fileDigest(path) {
  const before = await regularFile(path),
    hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close().catch(() => {});
  }
  const after = await regularFile(path);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  )
    throw Error("Daily backup file changed during integrity verification.");
  return { bytes: after.size, sha256: hash.digest("hex") };
}
export async function readSigned(path, config) {
  await regularFile(path, 1024 * 1024);
  return authenticate(JSON.parse(await readFile(path, "utf8")), config);
}
export async function writeSigned(path, payload, config, initial = false) {
  const temporary = join(dirname(path), `.writing-${randomUUID()}`);
  await writeFile(
    temporary,
    JSON.stringify(sign(payload, config), null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  await protectPrivatePath(temporary);
  if (initial) {
    // Atomic publication without replacing a pre-existing completed artifact.
    const { link, unlink } = await import("node:fs/promises");
    await link(temporary, path);
    await unlink(temporary);
  } else await rename(temporary, path);
}
export async function receiptPath(directory) {
  if (
    !UUID.test(basename(directory)) ||
    resolve(dirname(directory)) !== (await realpath(restoreRoot)) ||
    (await lstat(directory)).isSymbolicLink()
  )
    throw Error(
      "Daily restore receipt must belong to the private restore directory.",
    );
  return join(directory, "receipt.json");
}
