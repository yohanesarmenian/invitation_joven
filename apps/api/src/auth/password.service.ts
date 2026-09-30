import { Injectable } from "@nestjs/common";
import { Algorithm, hash, verify } from "@node-rs/argon2";

export const ARGON2ID_PARAMETERS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  parallelism: 1,
  timeCost: 2,
} as const;

const DUMMY_PASSWORD =
  "dummy admin password for timing-safe verification only";

@Injectable()
export class AdminPasswordService {
  private dummyHashPromise: Promise<string> | null = null;

  hashPassword(password: string): Promise<string> {
    return hash(password, ARGON2ID_PARAMETERS);
  }

  verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password, ARGON2ID_PARAMETERS);
  }

  async verifyAgainstDummy(password: string): Promise<boolean> {
    const dummyHash = await this.getDummyHash();

    return this.verifyPassword(dummyHash, password);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hashPassword(DUMMY_PASSWORD);

    return this.dummyHashPromise;
  }
}
