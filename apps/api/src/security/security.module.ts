import { Module } from "@nestjs/common";
import { CredentialSecretProvider } from "./credential-secret.provider.js";
import { CredentialService } from "./credential.service.js";

@Module({
  providers: [CredentialSecretProvider, CredentialService],
  exports: [CredentialService],
})
export class SecurityModule {}
