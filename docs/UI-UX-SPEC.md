# UI/UX Specification

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

## Public Flow

```text
Closed Envelope
  -> click/tap
Opened Cover
  -> automatic or click transition
Main Invitation
  -> RSVP
  -> Submit
  -> Registered / QR confirmation

Main Invitation
  -> Send Message
  -> Message Sent overlay
  -> Back to Invitation
```

The church Google Maps control contains an additional prototype interaction that appears unintended. Production should treat normal click-to-Google-Maps behavior as the meaningful requirement.

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
- On larger screens, keep the invitation as a centered narrow editorial experience.
- Initial max invitation content width: approximately 480 px.
- Do not turn the public invitation into a wide desktop dashboard.

## Animation Intent

- Closed envelope should feel like the invitation is being opened.
- Opened cover may transition automatically or by click/tap into the main invitation.
- Motion should enhance the wedding experience without blocking content access.
- Respect reduced-motion preferences.
- Final envelope animation depends on separated production assets.

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
- QR pass is displayed only after accepted RSVP and active pass issuance, which happen atomically in the backend.

## Confirmation States

### Registered / QR confirmation

- Shows successful RSVP acceptance.
- Displays backend-generated QR for active household CheckinPass.
- Shows Back to Invitation action.
- The backend must not commit an accepted RSVP without the required pass state. If submission fails, show a recoverable RSVP submission error rather than a successful registered state.

### Declined confirmation

- Figma does not define this clearly.
- Production needs a confirmation state for declined RSVP without QR.
- Exact copy/visual treatment is unresolved but must preserve main invitation return path.

### Message confirmation

- Shows "Message Sent!" overlay.
- Back to Invitation returns to long page context.

## Loading, Disabled, Validation, and Error States

Public invitation:

- Loading state while resolving invitation token.
- Not found/unavailable invitation state without exposing whether the credential is unknown, archived, or previously valid.
- RSVP submit disabled while request is pending.
- Form-level validation for required status, eligible events, RSVP attendee rows, event expected counts, and dietary field limits.
- API error state for deadline passed, unavailable invitation, ineligible event, event not selected, companion limit exceeded, RSVP version conflict, and network failure.
- Message submit disabled while pending.
- Message error state with retry.

Admin:

- Login loading and failed-auth states.
- Table loading/empty/error states.
- Import preview states for valid, warning, and error rows.
- Check-in scanner states for ready, scanning, validating, valid preview, already confirmed, revoked/invalid QR, event not allowed, event not selected, offline/network error, and confirmed.
- QR validation preview must not imply a reservation. Confirmation can still fail if another operator confirms first.

## Accessibility

- Envelope open action must be keyboard accessible.
- Buttons and controls require accessible names.
- Semantic radio behavior for RSVP accept/decline.
- Color swatches need text labels; do not rely on color alone.
- Forms require labels and error associations.
- QR confirmation should include text fallback.
- Motion should respect `prefers-reduced-motion`.
- Contrast must be verified during implementation.

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

## Public Privacy

The public UI may display household greeting, invited names needed for RSVP, eligible event details, RSVP status, and active QR after acceptance. It must not expose internal IDs, token hashes, admin notes, other invitations, or searchable guest data.

Archived invitations use the same public unavailable state as unknown credentials. The UI must not reveal whether a link was once valid.

## Unresolved UI Items

- Wedding date / RSVP deadline conflict: BLOCKING CONTENT CONFIRMATION REQUIRED.
- Parking Guide behavior: unresolved; do not choose image/modal/PDF/map/page without approval.
- Final production copy and image set: unresolved.
- Declined RSVP confirmation copy/state: production state required but exact design unresolved.
