// Operator-only entry point for the compiled production image. Reuse the
// existing locked bootstrap contract without a runtime package download.
try {
  const { bootstrapOwner } =
    await import("../../apps/api/dist/auth/bootstrap-owner.js");
  const result = await bootstrapOwner({
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  });
  if (result.created) console.log("Created OWNER admin user.");
  else {
    console.error("OWNER bootstrap refused: an admin user already exists.");
    process.exitCode = 1;
  }
} catch {
  console.error("OWNER bootstrap failed; credentials and diagnostics omitted.");
  process.exitCode = 1;
}
