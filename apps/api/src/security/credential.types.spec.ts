import { describe, expect, it } from "vitest";
import {
  credentialNamespaces,
  isCredentialNamespace,
} from "./credential.types.js";

describe("credential helper types", () => {
  it("keeps the Phase 2 credential namespace boundary narrow", () => {
    expect(credentialNamespaces).toEqual(["invitation", "check-in"]);
    expect(isCredentialNamespace("invitation")).toBe(true);
    expect(isCredentialNamespace("check-in")).toBe(true);
    expect(isCredentialNamespace("admin-session")).toBe(false);
  });
});
