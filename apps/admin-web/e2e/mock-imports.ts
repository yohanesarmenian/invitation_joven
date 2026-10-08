import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { preview } from "../tests/import-fixtures";

// Wire-level proof through the existing same-origin proxy. Only synthetic test
// files are accepted here; this is not a CSV parser or a production API.
export async function mockImports(
  request: IncomingMessage,
  response: ServerResponse,
  session: { csrf: string } | undefined,
) {
  if (request.url !== "/api/admin/imports/guest/validate") return false;
  const fail = (status: number) => {
    response.statusCode = status;
    response.end(
      JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid test upload",
          details: null,
        },
      }),
    );
    return true;
  };
  if (!session) return fail(401);
  if (
    request.method !== "POST" ||
    request.headers.origin !== "http://localhost:3001" ||
    request.headers["x-csrf-token"] !== session.csrf
  )
    return fail(403);
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data; boundary="))
    return fail(400);
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const form = await new Response(new Uint8Array(Buffer.concat(chunks)), {
      headers: { "Content-Type": contentType },
    }).formData();
    const file = form.get("file");
    if (
      [...form.keys()].join(",") !== "file" ||
      !(file instanceof File) ||
      file.name !== "import.csv" ||
      (await file.text()) !==
        (await readFile("e2e/fixtures/import.csv", "utf8"))
    )
      return fail(400);
    response.statusCode = 201;
    response.setHeader("X-Test-Multipart-Verified", "true");
    response.end(JSON.stringify(preview));
    return true;
  } catch {
    return fail(400);
  }
}
