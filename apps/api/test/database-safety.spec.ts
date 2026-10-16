import { afterEach, expect, it } from "vitest";
import databaseSafety from "./database-safety.js";
const original = {
  DATABASE_URL: process.env.DATABASE_URL,
  INVITATION_DATABASE_TESTS: process.env.INVITATION_DATABASE_TESTS,
};
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
it.each([
  ["postgresql://unused@localhost/invitation_dev", "1"],
  ["postgresql://unused@localhost/production", "1"],
  ["postgresql://unused@remote.example.test/invitation_ci", "1"],
  ["postgresql://unused@localhost/invitation_ci", "0"],
  ["not-a-url", "1"],
])(
  "rejects unsafe database-test configuration before connecting (%#)",
  (url, flag) => {
    process.env.DATABASE_URL = url;
    process.env.INVITATION_DATABASE_TESTS = flag;
    expect(() => databaseSafety()).toThrow();
  },
);
it("accepts an explicitly selected isolated local QA database", () => {
  process.env.DATABASE_URL =
    "postgresql://unused@127.0.0.1/invitation_qa_safety";
  process.env.INVITATION_DATABASE_TESTS = "1";
  expect(() => databaseSafety()).not.toThrow();
});
