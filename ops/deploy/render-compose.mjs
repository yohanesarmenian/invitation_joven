import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

export function nativeCompose(source) {
  const document = parse(source);
  if (document?.services?.migrate?.exclude_from_hc !== true)
    throw Error("Expected the explicit Coolify migration health exclusion.");
  // Only this documented Coolify extension differs from native Compose.
  delete document.services.migrate.exclude_from_hc;
  return stringify(document);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await mkdir(".local-daily", { recursive: true });
  await writeFile(
    ".local-daily/coolify.native.yaml",
    nativeCompose(await readFile("compose.coolify.yaml", "utf8")),
  );
  console.log(
    "Rendered native Compose for local/CI verification; no environment values expanded.",
  );
}
