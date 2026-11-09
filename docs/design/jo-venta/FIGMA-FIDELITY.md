# Figma content with a full-viewport invitation

## Current owner revision — 9 November 2026

The latest instruction supersedes the centered 412 px layout and the strict Figma gallery geometry below. Content, family names, typography and local decorations follow the owner's design. The application fills the browser width with readable inner content limits on desktop. The cream canvas has no navy outer gutters. The envelope occupies one viewport height. Its non-interactive photo hero reflows to keep copy and photography readable.

The approved Modern Editorial Luxury opening uses responsive native navy paper folds and a champagne CSS monogram seal, informed by the existing envelope artwork. One activation follows `closed -> opening -> content`. The approved couple photograph forms a non-interactive editorial hero within the prepared content. Authorized forms and links are mounted behind the envelope with `inert` and `aria-hidden` until opening completes. Fonts and decoded hero photography gate readiness for at most 3,500 ms. Image errors and timeouts use a stable paper/typographic fallback. Transition completion and a bounded fallback timer release content and transfer focus. Reduced motion completes immediately on activation. Gallery assets remain lazy.

Earlier live inspection showed a 522 px viewport and `prefers-reduced-motion: reduce`. The in-page Animations control follows the device by default and allows explicit opt-in. Only the non-sensitive `full`/`reduced` preference is stored under `jo-venta-motion`. The choice survives reload and remains usable in memory if storage is blocked. Opening stage is held only in component memory and reload starts closed. Missing IntersectionObserver leaves content usable. Forms and pass controls remain outside section-reveal effects. Preparation preserves the existing server retrieval and adds no analytics or mutation requests.

The countdown previously updated its clock each second but displayed only minutes. It now renders four numeric parts, including visibly changing seconds, computed from the next eligible event instant. Event display continues to use Asia/Jakarta.

Photography uses the already approved high-resolution derivatives of the six originals in `gambar-edit`: Cover for the hero, Venta/JJo for profiles, Pic2 for the landscape gallery lead, Pic3/Pic1 for two portraits and Cover for the final banner. Small Figma photo exports are no longer enlarged. The gallery layout is an original interpretation of the photo-led direction in the existing REA evidence; vendor code, photographs and artwork are not used. Profile labels stay clear of photos and names. Horizontal clipping does not create a hidden scroll container that can shift the composition when a decorative image is brought into view.

RSVP shows the Figma question headings and order: Attendance Confirmation, Events Attending, Bring someone special?, Dietary Restrictions & Preferences. Questions are visible before an attendance choice; decline hides acceptance-only controls. Native exclusive attendance radios have the source's square visual treatment. Eligible events remain independently selectable, with an all-events shortcut; named attendees, plus-one allowance, child limits, event counts and dietary validation remain authoritative. The children checkbox/count is shown only when permitted.

Owner-confirmed companion rule, 16 October 2026: a spouse uses the same plus-one allowance. RSVP provides one combined “Wife/Husband or plus one” checkbox, counted as one additional guest. A spouse already listed among named invitees should be selected by name instead of counted twice. The existing PLUS_ONE payload, invitation allowance and limits remain authoritative; there is no additional spouse entitlement or new relationship field. The Figma's 100% Halal claim is not added without final venue confirmation. These are documented differences, not a claim of exact pixel/behavior identity for every household.

Companion wording follow-up: 231 unit tests, lint, the TypeScript build and six focused RSVP browser regressions passed after this confirmation. Existing count/payload assertions continue to prove one additional attendee, without changes to backend contracts or database schema.

The local mock API's explicit `INVITATION_MOCK_PRESENTATION=figma` mode uses the Figma church, Margo Ballroom, addresses and Maps links, with synthetic guest data. Regression fixtures retain their default test names and URLs. This preview does not publish venue content or change production/backend records; final venue, parking/rundown and food details still need owner review.

Current QA: 231 frontend unit tests, lint and the TypeScript application build passed. All 19 built-local browser checks passed, including animation opt-in despite reduced motion, persistence across reload, fold transforms, cover/content transition, focus, full-width geometry, responsive text, countdown seconds, zero horizontal scroll offsets and local asset decoding. All 38 RSVP/message regression tests passed, including create/edit/decline, concurrency conflict recovery, uncertain-outcome handling, keyboard controls and canonical pass lifecycle. Only local mock data without an active QR appears in review screenshots. Backend/admin suites were not rerun. Asset integrity checks retain all 31 legacy public assets and six original photos byte-for-byte; no staging, commits or deployment.

## Earlier Figma baseline — layout/photo choices superseded

16 October 2026, Asia/Jakarta. The owner's final instruction is to follow the invitation's Figma design; REA informs supporting motion and interactions. Earlier photo-panel prototypes and partial CSS rollbacks are superseded.

## Evidence and scope

Figma file `yZZNWQ8kQIymOTixjymzoC` was read using high-fidelity design context and its rendered screenshot. Fresh context: closed `7:2`, opened `14:7`, long invitation `17:18`, message confirmation `82:113`. Registered `81:42` uses the high-fidelity response already obtained on 15 October: Figma MCP returned a Starter-plan call limit for the fresh request. Its current canvas state could not be independently refreshed. Reference screenshots are QA targets, never application assets.

28 source image/SVG exports are stored locally under `public/assets/figma`; metadata/provenance are in `figma-asset-manifest.json`. Runtime URLs are local and contain no expiring Figma URLs. Existing assets and original files in `gambar-edit` are preserved. Photo exports in the current Figma already contain Jo & Venta, including the gallery image not represented by the earlier Cover reuse.

| Surface     | Figma target                                                                | Application                                                                                      |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Frame       | 412 px wide, cream/navy, centered desktop                                   | `figma-invitation-theme.css`; no desktop photo panel                                             |
| Closed      | Three local image layers, wax seal                                          | Accessible button; 1200 ms staggered paper folds reveal the preloaded cover, with focus transfer |
| Opened      | Source photo crop: width 148.54%, left -32.86%; white gradient              | Clean local export, separate semantic title; preserved legacy fallback on image failure          |
| Cover type  | Spectral 32 px, -3.2 px tracking; Luxurious Script 96 px, -2.88 px tracking | Actual project fonts and corresponding CSS at reference width; smaller-phone adaptation          |
| Couple      | Bride 136×186 at x52; groom 137×186 at x203, opposite copy                  | Responsive proportional slots, 20 px radius; exact exported groom crop percentages               |
| Couple type | Luxurious Script 36 px role; Spectral Bold 14 px names; family 11/14 px     | Owner-requested readability adjustment: roles stay in the text columns, clear of photos/names    |
| Date        | Calendar 59×52; 24 px Spectral, date bold                                   | Native layout with local calendar export; source date kept, event times remain API-owned and WIB |
| Events      | Script 36 px; times 32 px; venue 16 px; address 14 px                       | Eligible API events; original object-sheet ring/ornament crops; Maps and calendar actions        |
| Dress       | Spectral Bold 24 px; native 307×47 SVG palette                              | Exact local SVG, accessible textual color references retained offscreen                          |
| Gallery     | Asymmetric 194×258 / 122×162 / 207×275 / 154×205 slots                      | Four current Figma exports, crop geometry and verse in the right gap; full-image keyboard dialog |
| Message     | Peach card, local envelope icon, 20/15 px Spectral                          | Existing success/focus/return state, local icon and source wording; no guest text echoed         |
| Pass        | Peach card, 20/15 px Spectral, floral groups                                | Cached high-fidelity decorative groups; actual backend-issued QR and human-readable code         |

## Deliberate runtime adaptations

The page is interactive and household-specific. Eligible event counts, names, RSVPs, invitees, companion entitlements, dietary fields, validation/recovery notices, optional uploaded venue content and text lengths reflow rather than being pinned to absolute Y coordinates. Static Figma checkbox artwork does not create a new spouse/child entitlement or replace an exclusive attendance radio group. An optional author field and validation/helper content remain available for messages.

The Figma deadline `25 December 2027` remains superseded by the existing owner decision and backend value: 25 December 2026, 23:59:59 WIB. Venue claims such as Halal service remain subject to final factual approval.

The QR in Figma is a 136 px placeholder. The application keeps a real QR at at least 200 px on supported phone widths, a four-module white quiet zone, and a selectable fallback code; the card can grow with real content. Controls retain 44 px hit areas. These are functional/accessibility adaptations, not a claim of whole-page pixel identity for every household/state. Countdown and calendar remain existing enhancements; their data comes from eligible events.

Motion is independently implemented with guarded native paper folds, existing section reveals, reduced-motion handling, keyboard focus, native photo viewing and explicit form recovery. The folds reveal the already-prepared hero and invitation. No Katsudoto code or design assets are reproduced.

## Verification

Historical 16 October envelope/readability verification recorded 231 frontend unit tests and 18 built-local browser tests. Those counts predate the 9 November one-click revision and do not verify its current implementation. Current phase results belong to the Phase 2 delivery report and PR.

Browser QA checks 320/360/390/412/768/1024/1440 px, no horizontal overflow, source photo slots and font sizes, reduced motion, repeated opening, focus, full-image gallery and fallback. Every captured image must decode and be complete/nonempty; crop wrappers are scrolled into view instead of the oversized cropped image node. An intermittent capture failure was resolved by awaiting the browser's image decode before asserting readiness; the image assertions remain enforced. Pass tests also load the local decorative images and preserve the QR size/containment/quiet-space checks.

SHA-256 checks confirm all 31 pre-existing public assets and all six original photos remain byte-identical. Compared with the before-work source snapshot, product changes are confined to invitation-web and its photography preparation helper; backend/admin source remains as it was. The existing dirty worktree is preserved. No files were staged, committed or deployed.

Privacy assertions still reject user-generated HTML and credential attributes. The fixed local confirmation icon and Next's `data-nimg` sizing metadata are explicitly distinguished from user content; no other arbitrary image or data attribute is allowed by those tests.

Runtime screenshots in `review/runtime-*` use only the synthetic household with no active pass. Pass/media diagnostics do not record a live guest credential or QR. Physical Safari/iOS/Android, screen reader testing, final venue material and hosting remain outside this local QA result.

## Updating assets

Edit the owner Figma/source photos, export the exact affected node, keep the original export, and use a new local filename or revision directory for replacement bytes. Update `figma-assets.ts` and `wedding-media.ts` as appropriate; do not overwrite an active image URL and assume the optimizer cache changes. Validate file metadata, slot/crop geometry, fonts, lightbox and the relevant browser paths after rebuilding. The older photography installer updates its own generated map and does not silently replace the current Figma exports.
