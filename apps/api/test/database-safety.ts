import "dotenv/config";
export default function databaseSafety() {
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error(
      "Database tests require an explicit isolated DATABASE_URL.",
    );
  }
  if (
    process.env.INVITATION_DATABASE_TESTS !== "1" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^invitation_(ci|qa_[a-z0-9_]+|workflow_smoke|test(?:_[a-z0-9_]+)?|5c_smoke)$/.test(
      url.pathname.slice(1),
    )
  )
    throw new Error(
      "Refusing database tests: set INVITATION_DATABASE_TESTS=1 and use an isolated local invitation test/QA database. Development and production databases are forbidden.",
    );
}
