# Public invitation typography — Phase 3C

The Romantic Cinematic invitation uses one type hierarchy across the native envelope, interior, functional controls and recoverable invitation error. The source is `components/invitation/romantic-invitation-theme.css`; `editorial-envelope.css` consumes the same inherited tokens. This applies to the public invitation only, not Admin.

## Families and supported styles

- **Spectral:** editorial body, names, titles and quotes. Load real normal/italic faces at 400/700; do not synthesize missing styles.
- **Albert Sans:** form text, helpers, actions, captions and statuses. Load 400/600, using 600 for actions and functional labels.
- **Luxurious Script:** the Jo & Venta hero identity only. It is not a generic section-heading, profile-label or closing typeface.

Parisienne and TikTok Sans are no longer requested by this route. No font package or replacement typeface is introduced. `font-synthesis: none` prevents artificial bold/italic styling. Font readiness remains part of the existing bounded envelope preparation.

## Shared roles

All sizes below use the default 16px root. Fluid roles have rem bounds so browser text enlargement can reflow the page.

| Role/token          | Typeface and scale                 | Use                                                                                  |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `--type-display`    | Script 400, 72–128px / 1.1         | Hero couple identity only                                                            |
| `--type-name`       | Spectral 400, 32–48px / 1.3        | Guest, envelope couple names, wedding date, closing phrase                           |
| `--type-title`      | Spectral 400, 32–44px / 1.3        | Every primary section title and recoverable error heading                            |
| `--type-subheading` | Spectral 400, 24–28px / 1.4        | Full couple names, events, questions, venue cards, feedback headings                 |
| `--type-label`      | Spectral italic 400, 20px / 1.5    | Dear, The Wedding of, Bride/Groom role, Wedding Date, reply deadline                 |
| `--type-body`       | Spectral 400, 16px / 1.8           | Editorial paragraphs; family names retain the established readable 17px size         |
| `--type-support`    | Albert Sans 400, 14px / 1.65       | Family descriptors, countdown labels, timezone, ordinal, helper, attribution, footer |
| `--type-control`    | Albert Sans 400, 16px / 1.6        | Native inputs, response text, messages, functional statuses                          |
| `--type-action`     | Albert Sans 600, 15px / 1.5        | Buttons, map/calendar actions and functional labels                                  |
| `--type-time`       | Spectral 400, 28–40px / 1.2        | Event times and countdown values                                                     |
| `--type-quote`      | Spectral italic 400, 24–40px / 1.5 | Scripture and photographic quote                                                     |
| `--type-monogram`   | Spectral 400, 32–48px / 1.2        | Hero/closing Y & A; wax seal retains its proportion within the seal                  |

## Casing, spacing and wrapping

The shared editorial label is natural case with normal letter spacing. Greeting/date do not need isolated casing overrides. No decorative label defaults to wide-tracked uppercase. Actual semantic abbreviations and identities such as WIB, RSVP, QR and Y & A retain their text.

The redundant Fine Attire label is removed. Dress Code is the sole heading; the attire explanation and approved palette remain intact. Headings remain center-led without centering every paragraph or portrait. Normal words wrap at spaces; long unbroken content has an emergency break opportunity. Use restrained negative tracking only for the compact monogram, never as default body/label decoration.

At large browser text settings the countdown switches to two columns when its inline container is narrower than 14rem, preserving whole labels. The RSVP introduction has `min-width: 0` so large text can reflow within the grid. Gallery actions can wrap. These are presentation constraints, not changes to event, RSVP or gallery behavior.

## Verification contract

Review 320, 375, 412, 768 and 1280px from envelope through closing, including optional published venue information. Capture actual computed family, size, weight, style, line height, tracking and casing. Review adjacent sections as a whole rather than signing off one isolated heading.

Synthetic browser fixtures include a short personal name, a long multiword household name, another multiword name, PT Organics and Teman-teman Gameku, plus long event/venue names. Group-like display labels are visual wrapping tests only: they grant no anonymous/group RSVP behavior.

Chromium tests change the browser default font from 16px to 32px with `Page.setFontSizes` and verify the root actually computes to 32px. They preserve viewport size, check real text-run bounds rather than document width alone, and exercise envelope/RSVP keyboard focus. This is browser default-text enlargement, not screenshot scaling or a replacement for physical-device/manual assistive-technology review.

No specialized UI/UX/frontend-design skill was installed in the inspected local skill catalog/directories for this pass. The work therefore uses the explicit systematic methodology above rather than claiming an unavailable skill.

Authentication, authorized retrieval/open recording, Y & A, full/family names, guest URLs, event order/timezone, RSVP rules/versions/persistence, guest messages, gallery interactions and reduced motion remain authoritative. No Admin, backend, schema, deployment or production data changes are part of this typography pass.
