import "server-only";
import { createInvitationApiClient } from "../../../../packages/api-client/src/index";
import { isPublicVenueResponse, venueFromApi } from "../content/venue-api";
import { getInvitationApiBaseUrl } from "./public-invitation";
import type { VenueContent } from "../content/venue-content";
export async function retrievePublishedVenue(
  publicCredential: string,
  events: readonly { id: string; name: string }[],
): Promise<VenueContent> {
  try {
    const { data, response } = await createInvitationApiClient({
      baseUrl: getInvitationApiBaseUrl(),
    }).GET("/api/public/invitations/{publicCredential}/venue-content", {
      params: { path: { publicCredential } },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !isPublicVenueResponse(data))
      return { parking: [], rundown: [] };
    const eligible = new Map(events.map((event) => [event.id, event.name]));
    const items = data.items
      .filter((item) => eligible.has(item.eventId))
      .map((item) => ({ ...item, eventName: eligible.get(item.eventId)! }));
    return venueFromApi(
      items,
      (_eventId, assetId) =>
        `/i/${encodeURIComponent(publicCredential)}/venue-assets/${assetId}`,
    );
  } catch {
    return { parking: [], rundown: [] };
  }
}
