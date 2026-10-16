import { getInvitationApiBaseUrl } from "@/src/server/public-invitation";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};
const unavailable = () =>
  new Response("Resource not found", { status: 404, headers });
export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ publicCredential: string; assetId: string }> },
) {
  const { publicCredential, assetId } = await params;
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(publicCredential) ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(assetId)
  )
    return unavailable();
  try {
    const response = await fetch(
      `${getInvitationApiBaseUrl()}/api/public/invitations/${encodeURIComponent(publicCredential)}/venue-assets/${assetId}`,
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    const mime = response.headers.get("content-type")?.split(";")[0];
    if (!response.ok || (mime !== "image/png" && mime !== "application/pdf"))
      return unavailable();
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024)
      return unavailable();
    return new Response(bytes, {
      headers: {
        ...headers,
        "Content-Type": mime,
        "Content-Disposition":
          mime === "application/pdf"
            ? 'attachment; filename="parking-guide.pdf"'
            : 'inline; filename="parking-map.png"',
      },
    });
  } catch {
    return unavailable();
  }
}
