import { Injectable } from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";
import {
  type CredentialDerivationInput,
  type CredentialDeriver,
  type CredentialHasher,
  type CredentialLookupHash,
  type CredentialNamespace,
  type DerivedCredential,
  isCredentialNamespace,
} from "./credential.types.js";
import {
  CREDENTIAL_SECRET_BYTE_LENGTH,
  CredentialSecretProvider,
} from "./credential-secret.provider.js";

export const CREDENTIAL_FORMAT_TAG = "v1";
export const DERIVED_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const CREDENTIAL_LOOKUP_HASH_PATTERN = /^[0-9a-f]{64}$/;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assertCredentialNamespace(
  namespace: unknown,
): asserts namespace is CredentialNamespace {
  if (!isCredentialNamespace(namespace)) {
    throw new Error("Invalid credential namespace.");
  }
}

export function canonicalizeCredentialStableId(stableId: string): string {
  if (!UUID_PATTERN.test(stableId)) {
    throw new Error("Invalid credential stable id.");
  }

  return stableId.toLowerCase();
}

export function canonicalizeCredentialVersion(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Invalid credential version.");
  }

  return String(version);
}

export function buildCredentialCanonicalInput(
  input: CredentialDerivationInput,
): Buffer {
  assertCredentialNamespace(input.namespace);

  return Buffer.from(
    [
      CREDENTIAL_FORMAT_TAG,
      input.namespace,
      canonicalizeCredentialStableId(input.stableId),
      canonicalizeCredentialVersion(input.version),
    ].join("\0"),
    "utf8",
  );
}

export function deriveCredentialWithSecret(
  input: CredentialDerivationInput,
  secretKey: Buffer,
): DerivedCredential {
  if (secretKey.length !== CREDENTIAL_SECRET_BYTE_LENGTH) {
    throw new Error("Invalid credential secret key.");
  }

  const credential = createHmac("sha256", secretKey)
    .update(buildCredentialCanonicalInput(input))
    .digest("base64url");

  if (!DERIVED_CREDENTIAL_PATTERN.test(credential)) {
    throw new Error("Credential derivation produced invalid output.");
  }

  return credential as DerivedCredential;
}

export function hashDerivedCredential(
  credential: DerivedCredential,
): CredentialLookupHash {
  return createHash("sha256")
    .update(credential, "utf8")
    .digest("hex") as CredentialLookupHash;
}

@Injectable()
export class CredentialService implements CredentialDeriver, CredentialHasher {
  constructor(private readonly credentialSecretProvider: CredentialSecretProvider) {}

  deriveCredential(input: CredentialDerivationInput): DerivedCredential {
    return deriveCredentialWithSecret(
      input,
      this.credentialSecretProvider.getSecretKey(),
    );
  }

  hashCredential(credential: DerivedCredential): CredentialLookupHash {
    return hashDerivedCredential(credential);
  }
}
