import "dotenv/config";
import { Injectable } from "@nestjs/common";

export const CREDENTIAL_SECRET_ENV = "CREDENTIAL_SECRET";
export const CREDENTIAL_SECRET_BYTE_LENGTH = 32;

const CREDENTIAL_SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

export class CredentialSecretConfigurationError extends Error {
  constructor(envVarName = CREDENTIAL_SECRET_ENV) {
    super(
      `${envVarName} must be a canonical unpadded Base64URL value that decodes to exactly 32 bytes.`,
    );
    this.name = "CredentialSecretConfigurationError";
  }
}

export function parseCredentialSecret(
  source: unknown,
  envVarName = CREDENTIAL_SECRET_ENV,
): Buffer {
  if (typeof source !== "string" || source.length === 0) {
    throw new CredentialSecretConfigurationError(envVarName);
  }

  if (
    source.trim() !== source ||
    source.includes("=") ||
    !CREDENTIAL_SECRET_PATTERN.test(source)
  ) {
    throw new CredentialSecretConfigurationError(envVarName);
  }

  const decoded = Buffer.from(source, "base64url");

  if (
    decoded.length !== CREDENTIAL_SECRET_BYTE_LENGTH ||
    decoded.toString("base64url") !== source
  ) {
    throw new CredentialSecretConfigurationError(envVarName);
  }

  return Buffer.from(decoded);
}

export function getCredentialSecretFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  return parseCredentialSecret(env[CREDENTIAL_SECRET_ENV]);
}

@Injectable()
export class CredentialSecretProvider {
  private readonly secretKey = getCredentialSecretFromEnv();

  getSecretKey(): Buffer {
    return Buffer.from(this.secretKey);
  }
}
