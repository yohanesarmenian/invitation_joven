import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { releaseManifest } from "./image-release.mjs";

const apps = ["api", "admin-web", "invitation-web"];
export function dockerCommand(args) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
      maxBuffer: 4_000_000,
      windowsHide: true,
    });
  } catch {
    throw Error("Registry/image verification failed; command output omitted.");
  }
}

export async function inspectImage({
  reference,
  repository,
  app,
  revision,
  command = dockerCommand,
}) {
  if (
    !apps.includes(app) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
    !new RegExp(
      `^ghcr\\.io/${repository.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${app}@sha256:[a-f0-9]{64}$`,
    ).test(reference ?? "")
  )
    throw Error(
      "Only coordinated immutable repository images may be inspected.",
    );
  const expectedDigest = reference.split("@")[1];
  const inspected = command(["buildx", "imagetools", "inspect", reference]);
  if (
    inspected.match(/^Digest:\s+(sha256:[a-f0-9]{64})\s*$/m)?.[1] !==
    expectedDigest
  )
    throw Error("Registry image digest mismatch.");
  let index, image;
  try {
    index = JSON.parse(
      command(["buildx", "imagetools", "inspect", "--raw", reference]),
    );
    if (index.manifests) {
      const runtime = index.manifests.filter(
        (item) => item.platform?.os !== "unknown",
      );
      if (
        runtime.length !== 1 ||
        runtime[0].platform.os !== "linux" ||
        runtime[0].platform.architecture !== "amd64"
      )
        throw Error();
    }
    command(["pull", "--platform", "linux/amd64", reference]);
    image = JSON.parse(command(["image", "inspect", reference]))[0];
  } catch {
    throw Error("Image manifest/platform inspection failed; details omitted.");
  }
  const config = image?.Config,
    labels = config?.Labels ?? {};
  const actualRevision = labels["org.opencontainers.image.revision"];
  if (
    image.Os !== "linux" ||
    image.Architecture !== "amd64" ||
    config.User !== "node" ||
    !config.Env?.includes(`APP=${app}`) ||
    !config.Healthcheck ||
    config.Healthcheck.Test?.[0] === "NONE" ||
    !isDeepStrictEqual(config.Cmd, ["sh", "ops/deploy/start.sh"]) ||
    !/^[a-f0-9]{40}$/.test(actualRevision ?? "") ||
    (revision !== undefined && actualRevision !== revision) ||
    labels["org.opencontainers.image.source"] !==
      `https://github.com/${repository}`
  )
    throw Error("Image revision/runtime/security metadata is not verified.");
  return {
    reference,
    digest: expectedDigest,
    revision: actualRevision,
    platform: "linux/amd64",
    user: "node",
    healthcheck: true,
  };
}

export async function verifyImages(manifest, { command = dockerCommand } = {}) {
  const expected = releaseManifest({
    repository: manifest.repository,
    sha: manifest.sourceSha,
    workflowSha: manifest.workflowSha,
    runId: manifest.workflowRunId,
    runAttempt: manifest.workflowRunAttempt,
    ciRunId: manifest.ciRunId,
    digests: Object.fromEntries(
      apps.map((app) => [app, manifest.images?.[app]?.digest]),
    ),
  });
  if (!isDeepStrictEqual(manifest, expected))
    throw Error("Image manifest is invalid.");
  const images = {};
  for (const app of apps)
    images[app] = await inspectImage({
      reference: manifest.images[app].reference,
      repository: manifest.repository,
      app,
      revision: manifest.sourceSha,
      command,
    });
  return {
    sourceSha: manifest.sourceSha,
    releaseId: manifest.releaseId,
    images,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
    const verification = await verifyImages(manifest);
    await writeFile(
      resolve(process.argv[2], "../verified-images.json"),
      `${JSON.stringify(verification, null, 2)}\n`,
    );
    console.log(
      "All three registry digests, source revisions and production image configurations verified.",
    );
  } catch {
    console.error(
      "Image verification failed. No deployable release was authorized.",
    );
    process.exitCode = 1;
  }
}
