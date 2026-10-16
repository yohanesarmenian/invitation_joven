import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { command, assertPortsAvailable } from "./database.mjs";
test("expected command refusal requires a nonzero exit and the actual expected diagnostic", async () => {
  const output = await command(
    process.execPath,
    ["-e", "process.stderr.write('synthetic refusal'); process.exitCode=2"],
    { expectedFailure: "synthetic refusal" },
  );
  assert.equal(output, "synthetic refusal");
  await assert.rejects(
    command(
      process.execPath,
      ["-e", "process.stderr.write('different failure'); process.exitCode=2"],
      { expectedFailure: "synthetic refusal" },
    ),
  );
});
test("occupied foreign listener is preserved by preflight", async () => {
  const server = net.createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    await assert.rejects(
      assertPortsAvailable([server.address().port]),
      /occupied or unavailable/,
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
