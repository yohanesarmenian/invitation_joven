export const credentialNamespaces = ["invitation", "check-in"] as const;

export type CredentialNamespace = (typeof credentialNamespaces)[number];

declare const derivedCredentialBrand: unique symbol;
declare const credentialLookupHashBrand: unique symbol;

export type DerivedCredential = string & {
  readonly [derivedCredentialBrand]: "DerivedCredential";
};

export type CredentialLookupHash = string & {
  readonly [credentialLookupHashBrand]: "CredentialLookupHash";
};

export type CredentialVersion = number;

export type CredentialDerivationInput = {
  namespace: CredentialNamespace;
  stableId: string;
  version: CredentialVersion;
};

export interface CredentialDeriver {
  deriveCredential(input: CredentialDerivationInput): DerivedCredential;
}

export interface CredentialHasher {
  hashCredential(credential: DerivedCredential): CredentialLookupHash;
}

export function isCredentialNamespace(
  value: unknown,
): value is CredentialNamespace {
  return (
    typeof value === "string" &&
    credentialNamespaces.includes(value as CredentialNamespace)
  );
}
