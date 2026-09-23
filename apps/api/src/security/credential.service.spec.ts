import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_SECRET_BYTE_LENGTH,
  CredentialSecretConfigurationError,
  CredentialSecretProvider,
  getCredentialSecretFromEnv,
  parseCredentialSecret,
} from "./credential-secret.provider.js";
import {
  buildCredentialCanonicalInput,
  CREDENTIAL_LOOKUP_HASH_PATTERN,
  CredentialService,
  DERIVED_CREDENTIAL_PATTERN,
  deriveCredentialWithSecret,
  hashDerivedCredential,
} from "./credential.service.js";
import type {
  CredentialDerivationInput,
  DerivedCredential,
} from "./credential.types.js";

const TEST_SECRET_BASE64URL =
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const TEST_SECRET_BYTES = Buffer.from(TEST_SECRET_BASE64URL, "base64url");
const TEST_INPUT = {
  namespace: "invitation",
  stableId: "01234567-89ab-4def-8123-456789abcdef",
  version: 1,
} satisfies CredentialDerivationInput;
const EXPECTED_CANONICAL_INPUT_HEX =
  "763100696e7669746174696f6e0030313233343536372d383961622d346465662d383132332d3435363738396162636465660031";
const EXPECTED_CREDENTIAL =
  "GqcxcwGaB27NYCErZeJhqWufpfVeSA-jFQkfG-qYBRE" as DerivedCredential;
const EXPECTED_LOOKUP_HASH =
  "725ce76a6b049c6dffaf1624b045fb34961ac04039921692c24e16dee757aebd";

function differentSecretBytes(): Buffer {
  return Buffer.from(
    Array.from({ length: CREDENTIAL_SECRET_BYTE_LENGTH }, (_, index) => index + 1),
  );
}

function withCredentialSecret<T>(value: string | undefined, action: () => T): T {
  const previous = process.env.CREDENTIAL_SECRET;

  try {
    if (value === undefined) {
      delete process.env.CREDENTIAL_SECRET;
    } else {
      process.env.CREDENTIAL_SECRET = value;
    }

    return action();
  } finally {
    if (previous === undefined) {
      delete process.env.CREDENTIAL_SECRET;
    } else {
      process.env.CREDENTIAL_SECRET = previous;
    }
  }
}

describe("credential derivation", () => {
  it("matches the locked golden vector", () => {
    expect(buildCredentialCanonicalInput(TEST_INPUT).toString("hex")).toBe(
      EXPECTED_CANONICAL_INPUT_HEX,
    );
    expect(deriveCredentialWithSecret(TEST_INPUT, TEST_SECRET_BYTES)).toBe(
      EXPECTED_CREDENTIAL,
    );
    expect(hashDerivedCredential(EXPECTED_CREDENTIAL)).toBe(
      EXPECTED_LOOKUP_HASH,
    );
  });

  it("returns an unpadded 43-character Base64URL credential", () => {
    const credential = deriveCredentialWithSecret(TEST_INPUT, TEST_SECRET_BYTES);

    expect(credential).toHaveLength(43);
    expect(credential).toMatch(DERIVED_CREDENTIAL_PATTERN);
    expect(credential).not.toContain("=");
    expect(credential).not.toContain("+");
    expect(credential).not.toContain("/");
  });

  it("canonicalizes uppercase UUID input to the same credential", () => {
    const uppercaseInput = {
      ...TEST_INPUT,
      stableId: TEST_INPUT.stableId.toUpperCase(),
    };

    expect(deriveCredentialWithSecret(uppercaseInput, TEST_SECRET_BYTES)).toBe(
      deriveCredentialWithSecret(TEST_INPUT, TEST_SECRET_BYTES),
    );
  });

  it("changes the credential when namespace, stable id, version, or secret changes", () => {
    const baseCredential = deriveCredentialWithSecret(
      TEST_INPUT,
      TEST_SECRET_BYTES,
    );

    expect(
      deriveCredentialWithSecret(
        { ...TEST_INPUT, namespace: "check-in" },
        TEST_SECRET_BYTES,
      ),
    ).not.toBe(baseCredential);
    expect(
      deriveCredentialWithSecret(
        {
          ...TEST_INPUT,
          stableId: "11234567-89ab-4def-8123-456789abcdef",
        },
        TEST_SECRET_BYTES,
      ),
    ).not.toBe(baseCredential);
    expect(
      deriveCredentialWithSecret({ ...TEST_INPUT, version: 2 }, TEST_SECRET_BYTES),
    ).not.toBe(baseCredential);
    expect(deriveCredentialWithSecret(TEST_INPUT, differentSecretBytes())).not.toBe(
      baseCredential,
    );
  });

  it("rejects invalid derivation input", () => {
    expect(() =>
      deriveCredentialWithSecret(
        { ...TEST_INPUT, stableId: "not-a-uuid" },
        TEST_SECRET_BYTES,
      ),
    ).toThrow("Invalid credential stable id.");
    expect(() =>
      deriveCredentialWithSecret({ ...TEST_INPUT, version: 0 }, TEST_SECRET_BYTES),
    ).toThrow("Invalid credential version.");
    expect(() =>
      deriveCredentialWithSecret(
        { ...TEST_INPUT, version: -1 },
        TEST_SECRET_BYTES,
      ),
    ).toThrow("Invalid credential version.");
    expect(() =>
      deriveCredentialWithSecret(
        { ...TEST_INPUT, version: 1.5 },
        TEST_SECRET_BYTES,
      ),
    ).toThrow("Invalid credential version.");
    expect(() =>
      deriveCredentialWithSecret(
        {
          ...TEST_INPUT,
          namespace: "checkin",
        } as unknown as CredentialDerivationInput,
        TEST_SECRET_BYTES,
      ),
    ).toThrow("Invalid credential namespace.");
  });
});

describe("credential secret provider", () => {
  it("accepts the canonical 32-byte unpadded Base64URL secret", () => {
    const decoded = parseCredentialSecret(TEST_SECRET_BASE64URL);

    expect(decoded).toEqual(TEST_SECRET_BYTES);
    expect(decoded).toHaveLength(CREDENTIAL_SECRET_BYTE_LENGTH);
  });

  it("rejects missing, empty, padded, whitespace-mutated, invalid, wrong-length, and non-canonical secrets", () => {
    const invalidSecrets = [
      undefined,
      "",
      `${TEST_SECRET_BASE64URL}=`,
      ` ${TEST_SECRET_BASE64URL}`,
      `${TEST_SECRET_BASE64URL}\n`,
      `${TEST_SECRET_BASE64URL}!`,
      Buffer.from([1, 2, 3]).toString("base64url"),
      Buffer.from(Array.from({ length: 33 }, (_, index) => index)).toString(
        "base64url",
      ),
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHhB",
    ];

    for (const secret of invalidSecrets) {
      expect(() => parseCredentialSecret(secret)).toThrow(
        CredentialSecretConfigurationError,
      );
    }
  });

  it("does not include secret material in validation errors", () => {
    const secret = `${TEST_SECRET_BASE64URL}=`;

    expect(() => parseCredentialSecret(secret)).toThrow(/CREDENTIAL_SECRET/);

    try {
      parseCredentialSecret(secret);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("0,1,2");
    }
  });

  it("reads the valid secret from the environment and fails when it is absent", () => {
    withCredentialSecret(TEST_SECRET_BASE64URL, () => {
      expect(getCredentialSecretFromEnv()).toEqual(TEST_SECRET_BYTES);
      expect(new CredentialSecretProvider().getSecretKey()).toEqual(
        TEST_SECRET_BYTES,
      );
    });

    withCredentialSecret(undefined, () => {
      expect(() => getCredentialSecretFromEnv()).toThrow(
        CredentialSecretConfigurationError,
      );
      expect(() => new CredentialSecretProvider()).toThrow(
        CredentialSecretConfigurationError,
      );
    });
  });

  it("returns a copy of the decoded secret key", () => {
    withCredentialSecret(TEST_SECRET_BASE64URL, () => {
      const provider = new CredentialSecretProvider();
      const first = provider.getSecretKey();
      first.fill(0);

      expect(provider.getSecretKey()).toEqual(TEST_SECRET_BYTES);
    });
  });
});

describe("credential lookup hashing", () => {
  it("matches the golden lookup hash", () => {
    expect(hashDerivedCredential(EXPECTED_CREDENTIAL)).toBe(
      EXPECTED_LOOKUP_HASH,
    );
  });

  it("is deterministic and produces lowercase 64-character hex", () => {
    const firstHash = hashDerivedCredential(EXPECTED_CREDENTIAL);
    const secondHash = hashDerivedCredential(EXPECTED_CREDENTIAL);

    expect(secondHash).toBe(firstHash);
    expect(firstHash).toHaveLength(64);
    expect(firstHash).toMatch(CREDENTIAL_LOOKUP_HASH_PATTERN);
  });

  it("changes when the credential changes", () => {
    const otherCredential = deriveCredentialWithSecret(
      { ...TEST_INPUT, version: 2 },
      TEST_SECRET_BYTES,
    );

    expect(hashDerivedCredential(otherCredential)).not.toBe(
      hashDerivedCredential(EXPECTED_CREDENTIAL),
    );
  });
});

describe("CredentialService", () => {
  it("uses the injected secret provider for derivation and hashing", () => {
    const service = new CredentialService({
      getSecretKey: () => Buffer.from(TEST_SECRET_BYTES),
    } as CredentialSecretProvider);

    const credential = service.deriveCredential(TEST_INPUT);

    expect(credential).toBe(EXPECTED_CREDENTIAL);
    expect(service.hashCredential(credential)).toBe(EXPECTED_LOOKUP_HASH);
  });
});
