import { Inject, Injectable, Optional } from "@nestjs/common";
import { tooManyLoginAttempts } from "./auth-errors.js";

export const ADMIN_AUTH_CLOCK = Symbol("ADMIN_AUTH_CLOCK");
export type AdminAuthClock = () => Date;

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_FAILURE_LIMIT = 10;
const PROCESS_FAILURE_LIMIT = 100;
const MAX_EMAIL_BUCKETS = 500;

@Injectable()
export class LoginThrottleService {
  private readonly emailFailures = new Map<string, number[]>();
  private processFailures: number[] = [];

  constructor(
    @Optional()
    @Inject(ADMIN_AUTH_CLOCK)
    private readonly currentTime: AdminAuthClock = () => new Date(),
  ) {}

  assertAllowed(email: string): void {
    const now = this.currentTime().getTime();
    this.prune(now);
    const emailFailures = this.emailFailures.get(email) ?? [];

    if (
      emailFailures.length >= EMAIL_FAILURE_LIMIT ||
      this.processFailures.length >= PROCESS_FAILURE_LIMIT
    ) {
      tooManyLoginAttempts();
    }
  }

  recordFailure(email: string): void {
    const now = this.currentTime().getTime();
    this.prune(now);
    const emailFailures = this.emailFailures.get(email) ?? [];
    emailFailures.push(now);
    this.emailFailures.set(email, emailFailures);
    this.processFailures.push(now);
    this.boundEmailBuckets();
  }

  recordSuccess(email: string): void {
    this.emailFailures.delete(email);
    this.prune(this.currentTime().getTime());
  }

  reset(): void {
    this.emailFailures.clear();
    this.processFailures = [];
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.processFailures = this.processFailures.filter((time) => time > cutoff);

    for (const [email, failures] of this.emailFailures.entries()) {
      const activeFailures = failures.filter((time) => time > cutoff);

      if (activeFailures.length === 0) {
        this.emailFailures.delete(email);
      } else {
        this.emailFailures.set(email, activeFailures);
      }
    }
  }

  private boundEmailBuckets(): void {
    if (this.emailFailures.size <= MAX_EMAIL_BUCKETS) {
      return;
    }

    const [oldestEmail] = this.emailFailures.keys();

    if (oldestEmail !== undefined) {
      this.emailFailures.delete(oldestEmail);
    }
  }
}
