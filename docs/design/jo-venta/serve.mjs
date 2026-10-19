// Read-only, loopback-only preview. Does not start Next, API, or a database.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const designRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(designRoot, "../../..");
const assetRoot = path.join(projectRoot, "apps/invitation-web/public/assets");
const buildRoot = path.join(projectRoot, "apps/invitation-web/.next/static");
const port = Number(process.env.DESIGN_PREVIEW_PORT ?? 4317);
const fontAliases = new Map();
try {
  for (const filename of await fs.readdir(path.join(buildRoot, "chunks"))) {
    if (!filename.endsWith(".css")) continue;
    const css = await fs.readFile(
      path.join(buildRoot, "chunks", filename),
      "utf8",
    );
    for (const block of css.matchAll(/@font-face\{[^}]+\}/g)) {
      const family = block[0].match(
        /font-family:(Spectral|Parisienne|Luxurious Script);/,
      )?.[1];
      const weight = block[0].match(/font-weight:(400|700);/)?.[1];
      const source = block[0].match(
        /src:url\(\.\.\/media\/([^)]*\.woff2)\)/,
      )?.[1];
      if (family && weight && source?.includes("-s.p."))
        fontAliases.set(
          `${family.toLowerCase().replaceAll(" ", "-")}-${weight}.woff2`,
          path.join(buildRoot, "media", source),
        );
    }
  }
} catch {
  /* CSS uses local system fallbacks when no previous Next build exists. */
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const previewFiles = new Set(["index.html", "prototype.css", "prototype.js"]);
const server = http.createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self'; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    let filename;
    if (pathname.startsWith("/assets/")) {
      filename = path.resolve(assetRoot, pathname.slice(8));
      if (!filename.startsWith(assetRoot + path.sep))
        throw new Error("outside assets");
    } else if (pathname.startsWith("/media/")) {
      filename = path.resolve(designRoot, pathname.slice(1));
      if (!filename.startsWith(path.join(designRoot, "media") + path.sep))
        throw new Error("outside media");
    } else if (pathname.startsWith("/fonts/"))
      filename = fontAliases.get(pathname.slice(7));
    else {
      const name = pathname === "/" ? "index.html" : pathname.slice(1);
      if (previewFiles.has(name)) filename = path.join(designRoot, name);
    }
    if (!filename || !mime[path.extname(filename)])
      throw new Error("not allowed");
    const bytes = await fs.readFile(filename);
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filename)],
      "Content-Length": bytes.length,
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
server.on("error", (error) => {
  process.stderr.write(`Preview could not start: ${error.code ?? "ERROR"}\n`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  process.stdout.write(
    `Design preview: http://127.0.0.1:${port}/?view=content\n`,
  ),
);
