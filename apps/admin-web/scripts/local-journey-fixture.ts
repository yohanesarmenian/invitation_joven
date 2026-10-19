import { writeFile, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";

async function main() {
  // The shared fixture checks the connected database identity before creating rows.
  const fixture = await createWorkflowFixture();
  const path = resolve(process.cwd(), ".local-journey.json");
  let manifest: string | undefined;
  try {
    const guest = await fixture.household("Android rehearsal household", {
      pending: true,
      plusOne: true,
      children: 1,
    });
    manifest =
      JSON.stringify(
        {
          purpose:
            "Synthetic local rehearsal only; never use these accounts for real guests.",
          database: new URL(process.env.DATABASE_URL!).pathname.slice(1),
          guestUrl: `${process.env.PUBLIC_INVITATION_BASE_URL}/i/${guest.publicCredential}`,
          staffUrl: `${process.env.ADMIN_ORIGIN}/login`,
          staffEmail: fixture.staff.email,
          ownerEmail: fixture.owner.email,
          password: fixture.password,
          event: fixture.event.name,
          cleanup:
            "Keep this terminal open. Ctrl+C removes only this fixture. Forced process termination may leave synthetic rows in the isolated QA database.",
        },
        null,
        2,
      ) + "\n";
    await writeFile(path, manifest, { flag: "wx", mode: 0o600 });
    console.log(`Private synthetic rehearsal details: ${path}`);
    console.log(
      "Keep this process open during Android testing; Ctrl+C cleans up its own fixture.",
    );
    await new Promise<void>((done) => {
      process.once("SIGINT", done);
      process.stdin.on("data", (data) => {
        if (data.toString().trim() === "cleanup") done();
      });
    });
    process.stdin.pause();
  } finally {
    await fixture.cleanup();
    if (
      manifest !== undefined &&
      (await readFile(path, "utf8").catch(() => undefined)) === manifest
    )
      await unlink(path);
  }
}
main().catch(() => {
  console.error(
    "Local rehearsal stopped; check the isolated QA setup and existing private fixture file.",
  );
  process.exitCode = 1;
});
