# UI/UX Specification

> Acuan final owner, 16 Oktober 2026: tampilan mengikuti Figma persis; REA hanya menjadi acuan animasi/interaksi. Runtime memakai figma-invitation-theme.css dan ekspor Figma terbaru. Lihat [pemetaan dan batas fidelity](design/jo-venta/FIGMA-FIDELITY.md). Keputusan prototype/susunan foto sebelumnya di bawah merupakan riwayat dan telah superseded.

## Figma template and owner photography, 16 October 2026

The current owner revision uses a full-viewport cream canvas with centered, readable inner sections; it supersedes the earlier 480 px outer-frame limit. The greeting remains left-aligned, bride/groom photo and copy alternate, and the existing Figma section order remains. See the [current owner revision](design/jo-venta/FIGMA-FIDELITY.md) and Responsive Strategy below for the active width contract. All four parental names/titles are owner-confirmed and rendered exactly as Figma. The clean owner Cover photo has separate semantic text; the preserved old hero is used only on image failure. Envelope transition takes 650 ms, prevents repeated activation and transfers focus; reduced motion advances immediately. Section reveal is optional and excludes forms, errors and the QR pass. Gallery uses reviewed original-photo derivatives, including a portrait thumbnail with an uncropped full-photo viewer. Photo filenames contain content digests so replacements change the cache key. Domain form behavior and eligibility remain authoritative from the existing contracts. See [implementation evidence and runbook](design/jo-venta/IMPLEMENTATION.md). Physical-device/screen-reader QA, final venue/footer copy and hosting remain pending.

## OWNER event materials

`/event-content` has an Event picker, optional parking/rundown forms, WIB datetime input, bounded activity add/remove, supporting-file upload and a reference-aware file library. Switching events is disabled while dirty or uncertain. Save draft does not publish. Preview draft/current publication uses the same original renderer as the invitation; unfinished times are explicitly omitted in draft preview. Publish/hide/delete and discarding local edits for reload require explicit confirmation. Referenced files cannot be deleted; clear the draft reference and update/hide publication first.

Busy and uncertain states prevent duplicate actions. Version conflicts or uncertain outcomes preserve local edits and require explicit authoritative reload; neither action is replayed automatically. Reload is a point-in-time read and warns that an earlier uncertain request may still finish. Unauthenticated responses end the session; CSRF refresh does not replay writes. File objects and draft/preview state stay in memory, not browser storage, and sign-out clears them. Guest sections remain optional and only contain backend-authorized current publications. User-facing errors are fixed messages without backend diagnostics or uploaded contents. Final content approval remains pending.

## Optional parking and rundown

Validated published venue content appears between Wedding Events and Dress Code. Each guide/schedule uses the authoritative eligible event's name. Parking shows text instructions, an optional lazy-loaded responsive map linking to its full image, an optional clearly labeled PDF link, and an optional Google Maps link. No empty actions or technical placeholder badge appear. Rundown uses an ordered list with explicit date and `HH.mm WIB`, including multi-day schedules. Text is escaped, never rendered as HTML. Empty, invalid, draft and ineligible sections are omitted.

Draft preview is at `/dev/venue-preview` with explicit `VENUE_CONTENT_PREVIEW=1` in development only. A notice identifies sample content and non-final directions/times. Synthetic event labels make clear that this is a content preview, not an actual household eligibility check. The No eligible event control demonstrates hidden sections. Fixed diagnostics identify invalid/missing files or assets without echoing file contents. The preview uses no guest credentials and returns 404 in production. Keyboard links have visible focus and 44px minimum targets; schedule columns wrap within mobile widths. Approved opening, hero and photos stay intact.

## Local completion additions (15 October 2026)

OWNER `/reports` shows expected/actual counts and household counts separately for each event, last-refresh time, explicit refresh, archived inclusion and optional event filter. Detail tabs/groupings are RSVP/dietary households, check-ins and not-arrived household/event rows; paginated detail and full filtered CSV share backend projections. Downloading a report never changes attendance. Missing data, errors, forbidden and loading have explicit states. Staff receives no report navigation or HTML.

Eligible public event cards may offer ICS only when startsAt is valid; endsAt is omitted when null and no duration is invented. Countdown chooses the next future eligible start without changing API event order; no eligible future instant hides it. Gallery opens a modal with keyboard navigation, Escape, focus containment/return and on-demand large image loading, preserving existing assets/hero. Missing parking/rundown content means no functional action or invented schedule. OWNER personal invitation message is an editable preview containing the currently fetched link and only known eligible event information, copied by explicit action in memory.

Figma design: `https://www.figma.com/design/yZZNWQ8kQIymOTixjymzoC/Wedding-invitation`

Figma remains the visual source of truth, but Figma visual representation is not literal production implementation. Responsive web layout, semantic controls, backend-generated QR, accessibility, and domain validation take precedence where needed.

## Public Screen Inventory

Known Figma screens/states:

1. `closed page`
   - 412 x 917.
   - Navy envelope.
   - Wax seal.
   - Entry point.
2. `opened page`
   - 412 x 917.
   - Full-screen pre-wedding photo.
   - "The Wedding of Jo & Venta".
3. `long page`
   - 412 x approximately 3610.
   - Complete invitation content.
4. `Registered`
   - 412 x 917.
   - RSVP confirmation.
   - QR placeholder.
   - Back to Invitation.
5. `message confirmation`
   - Confirmation overlay.
   - "Message Sent!".
   - Back to Invitation.

Verified Figma node references:

| State                | Node     | Reference size        |
| -------------------- | -------- | --------------------- |
| Closed invitation    | `7:2`    | 412 x 917             |
| Opened cover         | `14:7`   | 412 x 917             |
| Long invitation      | `17:18`  | 412 x 3610            |
| Registered           | `81:42`  | 412 x 917             |
| Message confirmation | `82:113` | later-phase reference |

Phase 4 implements only `closed page`, `opened page`, `long page`, loading,
unavailable, and generic unexpected-error states. `Registered` is a later
RSVP/QR confirmation reference state. `message confirmation` is a later guest
message reference state.

## Phase 4 Public Frontend Contract

Phase 4 route: `/i/[publicCredential]`.

Credential handling:

- The credential comes only from the route segment.
- It is case-sensitive and must not be normalized.
- It must not be stored in `localStorage`, `sessionStorage`, analytics payloads,
  visible error UI, or custom frontend logs.
- It must not be copied into client-visible diagnostic messages.

Data flow:

```text
Browser request /i/[publicCredential]
  -> invitation-web route
  -> server-side invitation retrieval boundary
  -> generated packages/api-client
  -> GET /api/public/invitations/{publicCredential}
  -> PublicInvitationResponse
  -> public frontend presentation
```

Phase 3 remains the only source of public invitation data. The frontend must not
access PostgreSQL, reproduce credential hashing, inspect credential versions,
infer archived/stale state, query guests by name, or expose other invitation
data.

Preferred rendering split:

- Server-side responsibilities: receive the route credential, call the Phase 3
  public API through the generated API client, obtain `PublicInvitationResponse`,
  map expected unavailable responses to one generic guest-facing unavailable UI,
  and provide invitation data to the presentation tree.
- Client-side responsibilities: local visual state only, including closed
  envelope, envelope/open transition, opened-cover transition, optional
  scroll/reveal behavior if approved, and reduced-motion handling.
- Client components must not duplicate invitation retrieval unless a later
  technical review documents a concrete need.
- Do not introduce TanStack Query for Phase 4 read-only retrieval unless later
  implementation proves it necessary.

Server-side API base environment contract:

- Variable: `INVITATION_API_BASE_URL`.
- Exposure: server-only. Do not prefix with `NEXT_PUBLIC_`.
- Expected local value: conceptually `http://localhost:4000`.
- The value contains only the API origin/base URL and never a credential.
- Missing value is a runtime configuration error for invitation retrieval. The
  guest UI should fail closed to the generic unexpected-error state without
  exposing server internals.
- Build should not require the API to be live.

Unavailable and error UX:

- `404 INVITATION_NOT_AVAILABLE` maps to one privacy-preserving unavailable
  state for malformed, unknown, stale, archived, and otherwise unavailable
  credentials.
- Do not display copy such as "invalid credential", "archived", "expired",
  "old link", "guest not found", or technical error codes to guests.
- Exact final unavailable copy is content pending.
- Unexpected API, network, or server failures use a separate generic
  technical-failure state. Exact final copy is content pending.
- A route-level App Router `loading.tsx` boundary is appropriate for Phase 4.
  Loading UI should fit the invitation visual language, avoid credential text,
  avoid major layout shift where practical, and not fake invitation content.

Phase 4 visible data classification:

| Area                   | Field/source                                                                       | Phase 4 handling                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest                  | `greetingName`, `displayName`                                                      | API-backed dynamic content for greeting/household copy; prefer `greetingName` where present and fall back to `displayName` where design needs a guest label.                                                                                        |
| Events                 | `name`, `startsAt`, `venueName`, `address`, `googleMapsUrl`                        | API-backed dynamic event content. Preserve API order. Render event time from `startsAt` in Asia/Jakarta as `HH.mm`. Render maps link only when `googleMapsUrl` is present.                                                                          |
| Rules                  | `allowPlusOne`, `maxAdditionalChildren`                                            | Later RSVP behavior data. Do not expose as raw rules unless required by read-only explanatory RSVP layout.                                                                                                                                          |
| RSVP                   | `status`, `version`                                                                | Later RSVP/update behavior data. May inform read-only copy only if a later Phase 4 slice explicitly needs it; do not create working RSVP state.                                                                                                     |
| Deadline               | `rsvpDeadlineAt`                                                                   | API-backed dynamic deadline when shown. The authority is the persisted `Invitation.rsvpDeadlineAt`; the Phase 5 public baseline is `25 December 2026, 23:59:59 Asia/Jakarta` (`2026-12-25T16:59:59Z`). Do not hard-code a deadline in the frontend. |
| Wedding content        | names, parent names, quote, closing, credits                                       | Fixed design/content reference, content pending until approved.                                                                                                                                                                                     |
| RSVP controls          | accept/decline, event choices, attendee choices, dietary fields, send confirmation | Later-phase interaction. Phase 4 must not create working form state, persistence, submission, confirmation, or QR display.                                                                                                                          |
| Guest message controls | message input and send message                                                     | Later Phase 7 interaction. No POST, fake submit, local persistence, or success overlay in Phase 4.                                                                                                                                                  |

Event rendering contract:

- Phase 3 sends eligible events in display order; Phase 4 must preserve that
  order.
- Do not reorder events by name.
- Do not hard-code event IDs.
- Do not assume exactly two events at the component contract level.
- Figma contains specific visual treatments for Holy Matrimony and Wedding
  Reception. Until slug-specific variants are explicitly documented, use generic
  event presentation with Figma-compatible styling and the API-provided event
  content.
- Event card time display is a frontend presentation concern. The API returns
  ISO date-time strings for `startsAt`; invitation-web renders those timestamps
  as venue-local Asia/Jakarta time in `HH.mm` 24-hour format, matching the
  current Figma time structure such as `08.00` and `12.00`.
- Do not rely on the server, browser, or developer workstation timezone for
  event time display.
- Do not synthesize Google Maps URLs from addresses and do not use frontend
  geocoding.

Deferred controls:

- Parking Guide behavior is unresolved. Phase 4 must not implement a functional
  Parking Guide action, link, modal, PDF, image, or map destination. The control
  is blocked/deferred unless a later approved slice supplies behavior; avoid a
  deceptively actionable button.
- RSVP and dietary controls are not functional in Phase 4. If retained for
  visual structure, they must be presentation-only and clearly non-interactive.
  If that would mislead guests, defer the actual controls to Phase 5 and retain
  only layout/copy scaffolding.
- Guest message controls are not functional in Phase 4. If retained for visual
  structure, they must be presentation-only and clearly non-interactive. The
  message confirmation state belongs to Phase 7.
- No Phase 4 route/component should navigate to or implement the `Registered`
  state.

## Public Flow

```text
Closed Envelope
  -> click/tap
Opened Cover
  -> click/tap
Main Invitation
  -> RSVP
  -> Submit
  -> Registered / QR confirmation

Main Invitation
  -> Send Message
  -> Message Sent overlay
  -> Back to Invitation
```

The full public flow above describes the MVP direction across phases. Phase 4
implements only the read-only invitation experience through the long invitation
page. RSVP submission, QR confirmation, guest message submission, and their
confirmation states belong to later phases.

The church Google Maps control contains an additional prototype interaction that appears unintended. Production should treat normal click-to-Google-Maps behavior as the meaningful requirement.

## Phase 4 Slice 3 Opening Interaction Contract

Locked three-stage opening flow:

```text
closed -> opened -> content
```

- Initial stage: `closed`.
- `closed -> opened`: explicit user tap/click on the closed envelope.
- `opened -> content`: a second explicit user tap/click on the opened cover.
- The opened cover is a real distinct user-visible stage, not an invisible
  transition frame.
- No automatic timer, autoplay, scroll-triggered transition, or route
  navigation advances the stage.
- No persistence: opening state is local in-memory client UI state only. It is
  not stored in `localStorage`, `sessionStorage`, cookies, query params, hash,
  or the backend. Refresh/reload returns to `closed`. The URL is unchanged.
- State transitions are forward-only in Slice 3: `closed -> opened`,
  `opened -> content`, `content -> content`.

Closed cover:

- Does not show the guest name (closed-cover guest copy is not source-locked).
- Does not invent visible CTA text; the envelope itself is the control.
- Accessible name: `Open invitation`.

Opened cover:

- Visible reference title: `The Wedding of Jo & Venta` (already documented
  opened-cover reference copy).
- The opened cover itself is the second interactive control.
- Accessible name: `View invitation`.
- No additional visible CTA button is added.

Placeholder authorization (Slice 3 through Slice 4A, temporary):

- Structural CSS placeholders are approved to remain through Slice 4A as
  temporary incomplete fidelity: navy envelope body, CSS envelope flap,
  simple paper/card geometry, basic shadows/borders, plain wax-seal circle,
  neutral opened-cover media placeholder, and the Bride/Groom/gallery
  structural image slots.
- They are NOT approved final assets. Slice 4B remains responsible for
  owner-approved final imagery/assets.
- Not allowed during 4A: invented monogram, invented wax artwork, stock
  photography, AI-generated imagery, fake wedding photos, invented flower
  illustration, or fake decorative artwork. No new placeholder artwork may be
  invented during 4A.

Animation:

- Native CSS transitions only. Motion for React is not required.
- Approximate transition duration: 400-600ms, ease-out.
- No timer-based state changes.
- `prefers-reduced-motion: reduce` keeps the three-stage state machine but
  renders visual transitions effectively instant; it does not skip the opened
  stage or auto-advance.

## Main Invitation Section Order

Preserve this general content journey unless a future documented UX decision changes it:

1. Guest greeting.
2. Bride.
3. Groom.
4. Wedding date.
5. Holy Matrimony.
6. Wedding Reception.
7. Dress Code.
8. RSVP and Dietary Information.
9. Pre-wedding gallery.
10. Bible verse / quote.
11. Guest message.
12. Closing.
13. Credit/footer.

## Typography

Observed Figma fonts:

- Spectral: primary editorial/content typography. Observed sizes include 11, 12, 14, 15, 16, 20, 24, 32, 40.
- Luxurious Script: approximately 36 px; used for Bride, Groom, Holy Matrimony, Wedding Reception, and display closing text.
- Parisienne: approximately 64 px; used for `Jo & Venta`.
- TikTok Sans: light/regular/bold/light italic; supporting/UI content.
- Albert Sans: approximately 14 px; action buttons such as View in Google Maps and Parking guide.
- Inter: present mainly in Figma palette/font documentation board; not a primary invitation font.

Implementation may simplify supporting sans typography only if documented with the trade-off. Do not silently replace the Figma typography system.

## Color System

Reference palette:

- Navy: `#1E2952`.
- Blue Grey: `#6D7991`.
- Peach: `#FFB39A`.
- Light Neutral: `#F5F5F5`.

Invitation background:

- `#FFF5E1`.

Dress code swatches:

- `#11256E`.
- `#6082FF`.
- `#FFE8BB`.
- `#9B9A99`.
- `#02ACA1`.

Do not merge dress-code swatches into the normal UI theme. Treat them as semantic wardrobe colors.

## Responsive Strategy

- Design is mobile-first around 412 px width.
- Do not copy absolute Figma positioning directly into CSS.
- Public invitation should support approximately 320, 360, 375, 390, 412, 430, and 480 px mobile widths.
- The current owner revision uses a full-viewport cream canvas. Both
  `.invitation-opening-flow` and `.public-invitation-surface` fill the viewport;
  the earlier centered 480 px outer-frame limit is superseded. Do not restore
  narrow outer gutters or turn the invitation into an admin dashboard.
- Inner sections remain horizontally centered with these maximum border-box
  widths, shrinking fluidly to fit smaller viewports:

  | Inner section                   | Maximum width |
  | ------------------------------- | ------------- |
  | Greeting/header, quote          | 900 px        |
  | Couple profiles, wedding events | 1040 px       |
  | Wedding date                    | 800 px        |
  | Dress code                      | 640 px        |
  | RSVP information                | 780 px        |
  | Guest messages                  | 720 px        |
  | Countdown                       | 620 px        |
  | Gallery mosaic                  | 1200 px       |

- At 700 px and above, couple profiles and wedding events use their existing
  two-column layouts within these limits. Mobile layouts retain their existing
  reflow behavior. No supported viewport may have horizontal document overflow.
- Browser QA covers 320, 375, 412, 480, 768 and 1280 px with a 2 px geometry
  tolerance, checking both the full-width canvas and centered inner limits.

## Animation Intent

- Closed envelope should feel like the invitation is being opened.
- Opened cover transitions into the main invitation by an explicit second
  click/tap; automatic transition is not used.
- Motion should enhance the wedding experience without blocking content access.
- Respect reduced-motion preferences.
- Final envelope animation depends on separated production assets.
- Phase 4 starts in the closed-envelope state.
- The open action must be an explicit accessible user action.
- The state model is local in-memory UI state. Do not persist envelope state in
  `localStorage` or `sessionStorage`.
- Animation must never gate access to fetched invitation data.
- Native CSS transitions are sufficient for initial Phase 4 implementation.
  Motion for React remains an allowed stack direction if later approved assets
  require coordinated transforms, but it is not required yet.
- Reduced-motion users must be able to open the invitation, reach all content,
  and use links without elaborate animation.

## RSVP Interaction Semantics

Figma visual behavior:

- Some inputs resemble checkbox-like controls.

Production behavior:

- Accept and decline are mutually exclusive states.
- Event attendance choices are constrained by InvitationEvent eligibility.
- Ineligible events are hidden or disabled.
- Backend validation is authoritative.
- Dietary information is attached to RSVP.
- Expected attendees may include named invitees, one permitted `PLUS_ONE`, and permitted `ADDITIONAL_CHILD` quantity.
- Known spouse and known children appear as normal named invitees.
- Event expected counts may differ from total attendee composition. MVP does not ask the guest to assign each named person to each event.
- Public RSVP submit must include the latest RSVP `expectedVersion`; stale update conflicts require reloading current RSVP state.
- A first-time household submits `expectedVersion: null`. The UI must not send a placeholder version for a household that has never RSVP'd.
- Accepting requires at least one selected attending event. The UI must block an accepted submission with zero event selections and surface the backend error if it still occurs.
- Dietary input is household-level, optional, and limited to 500 characters after trimming; an empty value is submitted as no dietary information.
- Decline clears dietary information along with event attendance and attendee selections.
- After the RSVP cutoff, the RSVP form is closed for both new and updated submissions and the deadline-passed state is shown. Public invitation content remains readable.
- QR pass is displayed only after accepted RSVP and active pass issuance, which happen atomically in the backend. Phase 5 does not render the QR; see `IMPLEMENTATION-ROADMAP.md` Phase 6. Phase 6 presents the pass inline within this RSVP surface (see Confirmation States).

## Confirmation States

### Registered / QR confirmation

- Shows successful RSVP acceptance.
- Displays the backend-derived QR for the active household CheckinPass.
- Shows Back to Invitation action.
- The backend must not commit an accepted RSVP without the required pass state. If submission fails, show a recoverable RSVP submission error rather than a successful registered state.

Phase 6 lock:

- Surface: the pass/QR is presented **inline inside the existing public RSVP/result surface** on the invitation long page. Phase 6 introduces no dedicated pass route, no `/c/...` route, no separate guest portal, and no navigation to another public page.
- The Figma `Registered` frame is a **visual reference** for the accepted/saved state, not a requirement to introduce new routing. If visual fidelity later needs a focused presentation state, it must still be hosted inside the existing invitation flow unless a future contract explicitly changes routing.
- The QR is shown only when the RSVP is `ACCEPTED` **and** an active pass exists. Otherwise no QR is rendered — never a disabled, blurred, or placeholder QR.
- "Back to Invitation" means returning to or dismissing the pass/result presentation within the existing invitation experience. It must not navigate to a new credential-bearing route.
- The QR must not be the sole representation of the pass: a textual fallback is required (see Accessibility), and the accepted state must be conveyed in text independently of the QR image.
- The pass remains visually part of the invitation and uses the invitation visual language.
- The QR is rendered from the `checkinPass.qrPayload` returned by the API. The payload is never placed in a URL, a query string, browser persistent storage, analytics, or logs.
- Guest pass UI must not display internal identifiers: no `CheckinPass.id`, no `tokenHash`, no `credentialVersion`, no `Invitation.id`, no `RSVP.id`.

### Declined confirmation

- Figma does not define this clearly.
- Production needs a confirmation state for declined RSVP without QR.
- Exact copy/visual treatment is unresolved but must preserve main invitation return path.

Phase 6 lock (resolves the declined state for the pass boundary; final copy remains as implemented):

- Phase 6 does **not** introduce a new declined flow. It reuses the existing declined confirmation implemented in Phase 5E.
- Declined state shows the existing confirmation notice and renders **no QR**, no pass credential, and no pass metadata. There is no disabled or placeholder QR.
- Guests may continue editing their response before the deadline under the existing RSVP rules; the pass boundary does not change RSVP mutation semantics.
- The existing success, error, conflict, deadline, and recovery architecture remains authoritative.
- Current implemented copy is defined by `apps/invitation-web/src/rsvp/notice.ts` (`rsvpSuccessNotice`): title "Thank you for letting us know", message "Your response has been saved as not attending. You can update your response before the reply deadline." Any future copy change is a separate copy decision and must not be invented during pass work.

### Message confirmation

- Shows "Message Sent!" overlay.
- Back to Invitation returns to long page context.

Phase 7 lock (Slice 7B0):

- Phase 7 replaces the existing placeholder in the guest message section at long-page position 11 (`apps/invitation-web/components/invitation/public-invitation-long-page.tsx`, `GuestMessageSection`). Section placement and the surrounding journey do not change.
- The guest flow remains: Invitation -> guest message section -> submit -> `Message Sent!` confirmation state -> Back to Invitation. The confirmation is an **in-flow presentation state** hosted inside the invitation experience.
- No route change is introduced. There is no dedicated messages page, no guest-message history, and no public message wall. Back to Invitation must not navigate to a message id, a guest-message route, or a public message list.
- `Message Sent!` remains the required success-state heading anchor from the UI spec.
- The form collects a required `message` and an optional `authorName`. Both are plain text. The message field must accept internal line breaks and must not interpret HTML or Markdown; the message body is never rendered with `dangerouslySetInnerHTML`.
- Submit is disabled while a submission is pending. A known server failure shows an error state with an explicit retry affordance. When the network outcome is uncertain, the UI must not automatically `POST` again and must not claim success without a confirmed response; the guest may explicitly retry, knowing it may create another message.
- After a successful submission the current form submission completes and the success state is shown. Because multiple messages per invitation are allowed, a later explicit new submission is permitted; the frontend must not persist a browser-side "already submitted forever" restriction.
- The guest message section never displays a previous message list. Admin moderation and hide/unhide surfaces belong to Phase 8+.

#### Phase 7 guest messages — specification status

Specified:

- Section placement at position 11, the `Message Sent!` success anchor, Back to Invitation returning to long-page context, submit-disabled-while-pending, an error state with retry, and the plain-text rendering rule.

Unspecified (do not invent during implementation without a separate copy/UX decision):

- Form labels, placeholder text, and submit button label.
- Whether the author-name field is shown, its label, and how optionality is communicated.
- Whether the confirmation is modal, inline, or a notice region, and its keyboard dismissal behavior.
- Any copy beyond the `Message Sent!` anchor.

## Loading, Disabled, Validation, and Error States

Public invitation:

- Loading state while resolving invitation token.
- Not found/unavailable invitation state without exposing whether the credential is unknown, archived, or previously valid.
- RSVP submit disabled while request is pending.
- Form-level validation for required status, eligible events, RSVP attendee rows, event expected counts, and dietary field limits.
- API error state for deadline passed, unavailable invitation, ineligible event, event not selected, companion limit exceeded, RSVP version conflict, and network failure.
- Message submit disabled while pending, with no duplicate client request.
- Message error state with an explicit retry affordance after a known failure. An uncertain network outcome must not trigger an automatic `POST` retry and must not show the success state without a confirmed response.
- Message content validation feedback for a missing, empty-after-trim, or over-1000-character message, and for an over-100-character author name, using the shared validation error presentation.

Admin:

- Login loading and failed-auth states.
- Table loading/empty/error states.
- Import preview states for valid, warning, and error rows.
- Check-in scanner states for ready, scanning, validating, valid preview, already confirmed, revoked/invalid QR, event not allowed, event not selected, offline/network error, and confirmed.
- QR validation preview must not imply a reservation. Confirmation can still fail if another operator confirms first.

Admin login and session states (locked in Phase 8 Slice 8B0):

- `/login` is the only public admin route. The dashboard and every management route are protected.
- Protected layouts bootstrap the session **server-side** by calling `GET /api/admin/auth/me` before rendering authenticated content, and redirect unauthenticated visitors to `/login`. Client-side-only protection is not used, and no Next `middleware.ts` is required for the MVP.
- Login fields: an email identifier and a password. The failed-auth state shows one generic message and never distinguishes unknown email, wrong password, or a disabled account.
- After a successful login, navigate to the admin dashboard. There is no re-auth modal in the MVP.
- Session expiry: when `/me` or any protected admin call returns `401 UNAUTHENTICATED`, return the user to `/login` with one concise generic state — "Your admin session has ended. Please sign in again." Do not distinguish expired, revoked, disabled, or missing sessions in frontend copy.
- Do not persist sensitive form drafts to browser storage merely to survive session expiry.
- Backend authorization remains authoritative even if the frontend redirect is bypassed.

Admin login screen design fidelity (fields, labels, visual treatment, responsive behaviour, and the authenticated landing surface) is **not specified in this document** and remains a UI decision for Slice 8C. Do not infer it from the public invitation visual direction.

## Admin Management UI Contract

**Locked by Phase 8 Slice 8D0 at the functional route and state level.** The Phase 8B0 login and session states above are unchanged. Visual design, component library choices, table density, and exact copy below the required confirmation content remain implementation decisions.

### Route table

Protected routes, all behind the server-side session bootstrap:

| Route                              | Surface                                                               |
| ---------------------------------- | --------------------------------------------------------------------- |
| `/`                                | Dashboard                                                             |
| `/invitations`                     | Invitation list                                                       |
| `/invitations/new`                 | Create invitation                                                     |
| `/invitations/[invitationId]`      | Invitation detail, invitees, eligibility, and bounded message summary |
| `/invitations/[invitationId]/edit` | Invitation edit                                                       |
| `/rsvps`                           | RSVP list                                                             |
| `/rsvps/[rsvpId]`                  | RSVP detail and OWNER override                                        |
| `/messages`                        | Global guest-message moderation                                       |

There is no top-level `/invitees`, `/events`, `/checkin`, `/imports`, or `/reports` route in Phase 8. Invitees and eligibility are managed from the invitation detail route, and invitation-scoped messages are read through the scoped API rather than a dedicated route.

### Navigation

The authenticated shell exposes: Dashboard, Invitations, RSVPs, Messages, plus OWNER identity and Sign out.

Imports, check-in, and reports are **not** rendered as disabled or placeholder navigation. Navigation for a phase that has not shipped must not exist. When Phase 9 ships, import is still reached from Invitations rather than from a new top-level Imports item; see "Import UI Contract".

### Required states per screen

Every management screen defines loading, empty, error, and session-ended states, plus success feedback where a mutation occurs.

List screens: the contracted filters and search, pagination controls, and deterministic sort controls only where the sort is genuinely useful. Empty states distinguish "no rows exist" from "no rows match the current filter".

Forms: field-level validation, a pending lock that prevents duplicate submission, server-side validation feedback, an explicit conflict state, and an explicit retry affordance. Unsafe mutations never auto-retry.

The session-ended state is the Phase 8B0 generic state; management screens must not distinguish expired, revoked, disabled, or missing sessions.

### Destructive actions

**Archive confirmation.** Archive removes **public** access but preserves admin history. The confirmation must state that the public invitation stops resolving, public RSVP access stops, public guest-message submission stops, public QR/check-in access is disabled under archive doctrine, and that admin history remains available. Explicit OWNER confirmation is required. **No unarchive affordance is offered.**

**Token regeneration confirmation.** Regeneration uses a stronger confirmation than archive. It must state that the current invitation link stops working immediately on success, that previously distributed old links will no longer work, and that the action cannot be undone. The current `publicTokenVersion` may be shown as operational metadata.

Regeneration behavior while pending and after:

- Exactly one pending request. **No automatic retry.**
- On confirmed success, show and offer to copy the returned new public URL.
- On network or transport uncertainty, do **not** send regeneration again. Call `GET /api/admin/invitations/{invitationId}/public-url` and show the currently valid URL. The UI must not claim that regeneration failed when the commit status is unknown.
- On `409 CONFLICT`, refetch the invitation detail and the current public URL.

**Invitee deletion confirmation.** Require confirmation before a hard delete. If the backend returns `409 CONFLICT` because an `RSVPAttendee` references the invitee, explain that an existing RSVP uses that person and deletion is not allowed. Do not offer a fake soft-delete or disable-only option.

### RSVP override

The override form clearly indicates that this is an OWNER action and requires an `overrideReason`. It may operate after the public RSVP deadline, and it preserves every canonical RSVP validation. An `RSVP_VERSION_CONFLICT` is handled by refetching and reviewing the current RSVP, never by an automatic retry. Raw `qrPayload` is never displayed.

### Guest message moderation

The `/messages` page shows plain-text content, an `authorName` value or an explicit anonymous state, the invitation context (`displayName`), `createdAt`, and the hidden state, with a hide/unhide action.

- Hidden content stays visible to the OWNER with a clear hidden marker.
- Hidden rows are **not** removed from the default `all` view.
- The page implies no public message wall, and nothing in the UI may suggest guests can read messages.

### Accessibility and responsive expectations

- Admin management surfaces keep the existing accessibility baseline: labelled form controls, error associations, visible focus states, accessible names, semantic table markup, and status announcements for mutation outcomes.
- Confirmation dialogs must be keyboard operable, must move focus into the dialog, must be dismissible, and must not rely on color alone to convey the destructive nature of the action.
- Tables must not cause horizontal document overflow at the responsive widths already covered by the admin auth E2E suite.

## Check-in Scanner UI Contract

**Locked by Phase 10B at the route, role, and state level.** No scanner UI is implemented by this documentation slice.

### Routes and role-specific shell

| Route             | Surface                        | OWNER   | CHECKIN_STAFF |
| ----------------- | ------------------------------ | ------- | ------------- |
| `/checkin`        | QR scanner and manual check-in | allowed | allowed       |
| `/settings/staff` | Staff account management       | allowed | forbidden     |

After login, OWNER lands on the dashboard unless they originally requested another authorized route. CHECKIN_STAFF lands on `/checkin`. Staff use a restricted scanner shell with Event picker, scan/manual controls, password/account controls, and logout only; no Dashboard, Invitations, RSVPs, Messages, Imports, Reports, or staff-management navigation is rendered.

Server-side route protection must run before privileged page data is fetched. If CHECKIN_STAFF manually enters an OWNER-only route, the UI shows an authorization denial or redirects to `/checkin` without rendering privileged data. Backend authorization remains authoritative.

### Staff management UI

`/settings/staff` is an OWNER-only minimal management screen:

- Staff account list with email, status, `mustChangePassword`, created time, and last login.
- Create staff account and display the one-time temporary password exactly once.
- Disable/reactivate staff account.
- Reset staff password and display the one-time temporary password exactly once.
- Session-revocation result is explicit for disable/reset.

The screen does not create OWNER accounts, does not expose password hashes, does not show staff sessions, and is not a general role-management platform.

### Scanner state machine

The scanner uses explicit states:

`READY`, `SCANNING`, `VALIDATING`, `VALID_PREVIEW`, `ALREADY_CONFIRMED`, `INVALID_OR_REVOKED`, `EVENT_NOT_ALLOWED`, `EVENT_NOT_SELECTED`, `OFFLINE_OR_NETWORK_ERROR`, `CONFIRMING`, `CONFIRMATION_UNCERTAIN`, `CONFIRMED`, `CAMERA_PERMISSION_DENIED`, `CAMERA_UNAVAILABLE`, `UNAUTHENTICATED`, `FORBIDDEN`.

Rules:

- Selecting an Event is required before validation/confirmation.
- Decoding a QR never confirms attendance automatically.
- Confirmation requires an explicit operator action and attendee count.
- Validation preview is not a reservation and can become stale before confirmation.
- During `CONFIRMING`, duplicate clicks are disabled.
- `CONFIRMATION_UNCERTAIN` never auto-retries. It offers explicit revalidation of the same QR/household and Event.
- `ALREADY_CONFIRMED` shows authoritative recorded state, including checked-in time, attendee count, method, and minimal operator identity when needed.

### Camera and fallback

- Camera scanning requires a secure browser context outside localhost.
- Camera starts only after user interaction and is released when leaving scanning, changing route, logging out, or unmounting.
- Permission denial, unavailable/busy camera, insecure context, and decode failure have distinct states.
- Manual QR code entry may reuse the QR validation path.
- Manual household search is separate from QR code entry and uses the constrained check-in search API.
- A QR decoder dependency is chosen during implementation based on maintenance, bundle size, browser support, TypeScript compatibility, and ability to release camera resources.

### Privacy

The scanner must not put `qrPayload` in the URL, browser history, persistent storage, analytics, screenshots, or logs. Staff preview data is minimal: household display name, Event name, expected attendee count, check-in status, and previous confirmation metadata where needed. The scanner does not display private invitation URL, notes, full invitee roster, guest messages, import history, credential hashes, or raw credentials.

## Import UI Contract

**Locked by Phase 9 Slice 9A at the route, state, and selection level.** Visual design, component choices, and copy below the required confirmation content remain implementation decisions.

### Route and entry point

| Route                 | Surface               |
| --------------------- | --------------------- |
| `/invitations/import` | CSV/XLSX guest import |

- The route is reached from an explicit **Import CSV/XLSX** action on `/invitations`. There is no top-level Imports navigation item.
- On `/invitations/import`, the **Invitations** navigation section remains active, because import is invitation management.

### States

The screen defines these states explicitly:

`IDLE`, `FILE_SELECTED`, `VALIDATING`, `PREVIEW_READY`, `COMMITTING`, `COMMIT_UNCERTAIN`, `SUCCESS`, `FAILURE`.

- `IDLE` offers file selection plus a template download affordance and states the accepted formats and limits.
- `FILE_SELECTED` shows the chosen file and requires explicit validation; selecting a file never uploads automatically.
- `VALIDATING` locks submission.
- `COMMITTING` locks submission and prevents a second commit request.
- `COMMIT_UNCERTAIN` is a distinct state from `FAILURE`, because an uncertain outcome is not a known failure.
- `SUCCESS` reports the committed batch summary.

### Preview

`PREVIEW_READY` displays:

- The summary counts, the source file metadata, and the preview expiry information.
- Each household row with its normalized household data, its invitees, and its eligible events.
- Per-row errors and warnings, using the structured issue model rather than parsing free text.
- Row selection state and warning acknowledgment state.

`ERROR` rows cannot be selected. `VALID_WITH_WARNINGS` rows require explicit acknowledgment before they can be selected. Both rules are enforced server-side as well; client enforcement is never sufficient.

Preview is a preview. The screen must not imply that rows already exist, and the summary must not be presented as a completed import.

### Commit

- Commit requires explicit confirmation and is never automatic.
- An uncertain outcome (`COMMIT_UNCERTAIN`) presents an explicit recovery affordance that resubmits the **exact same** preview and selection. It must not auto-retry, and it must not present the outcome as a failure.
- A stale-preview or expired-preview conflict sends the operator back to validation for a new preview rather than attempting to repair the committed selection.

## Accessibility

- Envelope open action must be keyboard accessible.
- Envelope open action must use real button semantics so Enter/Space work
  naturally.
- Focus states must be visible.
- Buttons and controls require accessible names.
- Semantic radio behavior for RSVP accept/decline.
- Color swatches need text labels; do not rely on color alone.
- Forms require labels and error associations.
- QR confirmation should include text fallback.
- The QR must not be the sole representation of the pass. A textual fallback must exist alongside it.
- The pass state (`ACTIVE` / accepted) must be screen-reader discoverable and conveyed with text, not by the presence of the QR image alone.
- The declined state must not rely on the absence of a QR to explain itself; it requires its own visible text.
- The QR image requires a meaningful accessible name describing it as the household check-in pass.
- No QR library is prescribed by this spec.
- Motion should respect `prefers-reduced-motion`.
- Contrast must be verified during implementation.
- Meaningful images require alt text. Pure decorative images should use empty
  alt text or CSS decoration.
- Deferred controls must not appear deceptively actionable.

## Image Performance

- Use Next Image where appropriate.
- Provide responsive sizes.
- Avoid loading the entire gallery at maximum resolution immediately.
- The opened-cover hero may use priority loading only if it is the first
  meaningful image after interaction.
- Decorative elements should avoid excessive network and JavaScript cost.
- Fixed wedding assets remain bundled with `apps/invitation-web` for MVP. Do
  not introduce S3, R2, CMS, or dynamic upload infrastructure for Phase 4.

## Asset Inventory Categories

Conceptual layout:

```text
public/assets/
  envelope/
    envelope-back
    envelope-left
    envelope-right
    envelope-flap
    wax-seal
  flowers/
    hydrangea variants
    floral ornaments
    leaves
  photos/
    hero
    bride
    groom
    pre-wedding gallery
  icons/
```

Do not assume flattened Figma images are already suitable as separated animation assets. Asset extraction/preparation is a dedicated implementation task.

Phase 4 asset classification:

| Asset category                | Status                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bride image                   | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Groom image                   | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Pre-wedding gallery images    | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Floral watercolor decoration  | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Leaves                        | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Rings illustration/icon       | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Calendar artwork              | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Decorative objects            | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Couple/opened-page hero image | Available in Figma only; missing from repo; approval/export required for final fidelity; structural placeholder allowed only if explicitly approved. |
| Envelope visuals              | Available in Figma only; separated production cuts missing from repo; blocks final envelope animation fidelity.                                      |
| Wax seal                      | Available in Figma only; missing from repo; approval/export required for final fidelity.                                                             |

Do not download Figma assets, create AI replacements, or commit font/image files
without approval and licensing clearance.

## Font Contract

| Font             | Design use                                                            | Phase 4 status                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spectral         | Primary editorial/content typography                                  | Available through Google Fonts; usable through `next/font/google`.                                                                                 |
| Luxurious Script | Bride, Groom, Holy Matrimony, Wedding Reception, display closing text | Available through Google Fonts; usable through `next/font/google`.                                                                                 |
| Parisienne       | `Jo & Venta` display title                                            | Available through Google Fonts; usable through `next/font/google`.                                                                                 |
| TikTok Sans      | Supporting/UI content                                                 | Publicly released under the SIL Open Font License with a Google Fonts download path; usable when available through the selected font loading path. |
| Albert Sans      | Action buttons such as View in Google Maps and Parking Guide          | Available through Google Fonts; usable through `next/font/google`.                                                                                 |

Do not copy fonts from a local system or container. Non-Google/custom fonts
require an approved licensed local source before use. Exact replacements must be
documented; do not silently substitute unrelated decorative fonts.

Fallbacks:

- Editorial serif fallback: `Georgia`, `Times New Roman`, serif.
- Script fallback: approved decorative fallback only if the target design font
  cannot be loaded; otherwise use a plain serif fallback rather than a random
  decorative substitute.
- Sans fallback: system UI stack.

## Phase 4 Slice 4A Font Loading

The five source-backed families are loaded through `next/font/google` with
`display: "swap"`, exposing CSS variables consumed by scoped invitation
selectors:

| Family           | Variable                  | Weights       |
| ---------------- | ------------------------- | ------------- |
| Spectral         | `--font-spectral`         | 400, 700      |
| Luxurious Script | `--font-luxurious-script` | 400           |
| Parisienne       | `--font-parisienne`       | 400           |
| TikTok Sans      | `--font-tiktok-sans`      | 300, 400, 700 |
| Albert Sans      | `--font-albert-sans`      | 400           |

- Fonts are route-scoped to the public invitation route via a route layout;
  they are not applied globally to `body`.
- No remote `<link>` stylesheet, no font binaries, no font npm package.
- TikTok Sans is loaded (verified `TikTok_Sans` export supports normal style,
  weights 300–900; italic is not supported and is not requested).

## Phase 4 Dependency Decisions

- Motion: not required yet. Use native CSS transitions for the initial
  closed/opened/long-page interaction. Revisit Motion for React only if approved
  separated assets require coordinated transforms that CSS cannot reasonably
  provide.
- Playwright: required before Phase 4 completion because the roadmap requires
  screenshots at target widths and the development rules require Playwright
  coverage when public critical UI exists. It does not need to be installed in
  Slice 0.
- React Hook Form, Zod, TanStack Query, and QR libraries are not required for
  Phase 4 read-only retrieval.

## Public Privacy

The public UI may display household greeting, invited names needed for RSVP, eligible event details, RSVP status, and the active QR after acceptance. It must not expose internal IDs, token hashes, credential versions, admin notes, other invitations, or searchable guest data. Guest messages are **write-only** from the public surface (Phase 7 Slice 7B0): the public UI submits a message and shows the `Message Sent!` confirmation, but never lists messages, never displays `GuestMessage.id`, and never exposes another guest's message. The active pass `qrPayload` is bearer credential material: it may be held only in normal in-memory/render state needed to draw the QR, and must not be written to a URL, query string, `localStorage`, `sessionStorage`, analytics, or logs.

Archived invitations use the same public unavailable state as unknown credentials. The UI must not reveal whether a link was once valid.

For Phase 4, the public UI consumes only the Phase 3 public DTO. It must never
expose `Invitation.id`, `publicTokenHash`, `publicTokenVersion`, `openCount`,
`firstOpenedAt`, `lastOpenedAt`, admin notes, other guests, or other invitation
data. Event and invitee UUIDs may be present inside the approved public DTO, but
Phase 4 should render them only if a visible UI requirement needs them; normal
read-only presentation should not display raw UUIDs.

## Unresolved UI Items

- RSVP deadline value: resolved in Phase 5 Slice 5B0 to
  `25 December 2026, 23:59:59 Asia/Jakarta` (`2026-12-25T16:59:59Z`), served from
  `rsvpDeadlineAt`. Do not hard-code the deadline in the frontend.
- Deadline-passed and stale-version conflict UX: the states are locked by
  contract, but final copy and visual treatment remain unresolved.
- Parking Guide behavior: unresolved; do not choose image/modal/PDF/map/page
  without approval. Blocks only a Parking Guide action.
- Final production copy and image set: unresolved. Blocks final visual/content
  fidelity, not basic Phase 4 structure when approved placeholders or existing
  reference copy are used.
- Declined RSVP confirmation copy/state: production state required but exact design unresolved.
