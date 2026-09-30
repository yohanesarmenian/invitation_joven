import { parseOptions, Algorithm } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";
import { ARGON2ID_PARAMETERS, AdminPasswordService } from "./password.service.js";

describe("AdminPasswordService", () => {
  it("hashes and verifies passwords with locked Argon2id parameters", async () => {
    const service = new AdminPasswordService();
    const password = "correct horse battery staple";
    const passwordHash = await service.hashPassword(password);
    const options = parseOptions(passwordHash);

    expect(passwordHash).toContain("$argon2id$");
    expect(options).toMatchObject({
      algorithm: Algorithm.Argon2id,
      memoryCost: ARGON2ID_PARAMETERS.memoryCost,
      parallelism: ARGON2ID_PARAMETERS.parallelism,
      timeCost: ARGON2ID_PARAMETERS.timeCost,
    });
    await expect(service.verifyPassword(passwordHash, password)).resolves.toBe(
      true,
    );
    await expect(service.verifyPassword(passwordHash, "wrong password")).resolves.toBe(
      false,
    );
  });

  it("performs bounded dummy verification for non-authenticatable login paths", async () => {
    const service = new AdminPasswordService();

    await expect(
      service.verifyAgainstDummy("synthetic wrong password"),
    ).resolves.toBe(false);
  });
});
