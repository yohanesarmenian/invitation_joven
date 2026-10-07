# Project Context

## Purpose

Wedding Invitation Platform is a personal wedding platform for a 2027 wedding. It is not a multi-tenant SaaS product. The system supports the guest journey from a personalized invitation URL through RSVP, backend-derived QR pass display, and event-aware venue check-in.

## Product Surfaces

1. Public Wedding Invitation Frontend
   - Personalized invitation URL.
   - Closed-envelope opening experience.
   - Mobile-first long-form invitation.
   - RSVP, dietary notes, guest message, confirmation, and active household QR pass display.
2. Admin Frontend
   - OWNER-only MVP administration.
   - Invitation and invitee management.
   - Event eligibility, RSVP oversight, guest import, check-in, reporting, and CSV export.
3. Backend API
   - Authoritative business rules.
   - Admin authentication/session handling.
   - Public invitation access.
   - RSVP, messages, QR credential derivation, check-in, import, reporting, and audit-safe operations.

## Source-of-Truth Hierarchy

1. Explicit product decisions approved by the project owner.
2. PRD.
3. Technical Architecture.
4. Database Schema.
5. API Contract.
6. UI/UX Specification.
7. Implementation Roadmap.
8. Implementation code.

Development Rules define how future changes move through this hierarchy. Implementation tasks must not silently override higher-authority documents.

## Selected Stack

- Repository: pnpm workspace, Turborepo, TypeScript.
- Public frontend: Next.js App Router, React, Tailwind CSS, Motion for React, React Hook Form, Zod, TanStack Query where useful.
- Admin frontend: Next.js App Router, React, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Query.
- Backend: NestJS, Fastify adapter, OpenAPI/Swagger, Prisma, PostgreSQL, Pino structured logging.
- Security: Argon2id admin password hashing, opaque server-managed admin sessions, deterministic server-derived credentials, credential hashing at rest, and strict log redaction.
- QR: backend-derived check-in credential, QR rendering library such as `qrcode`, browser scanner such as ZXing.
- Import: CSV and XLSX parsers are not yet chosen. Phase 9B reviews maintenance, security, streaming/memory behavior, and OpenAPI compatibility before any dependency is added; no package is locked by the Phase 9A contract.
- Testing: backend unit/integration tests, Vitest where appropriate, Playwright for E2E.
- Deployment: Docker, GitHub Actions, VPS/self-host friendly, compatible with Coolify-style deployment.

## Key Domain Rules

- One Invitation equals one household or invited group.
- One invitation can contain multiple named Invitees.
- Known spouse and known children are normal named Invitees.
- Optional unnamed adult companion is represented as `PLUS_ONE`.
- Optional unnamed/additional children are represented as `ADDITIONAL_CHILD`.
- `Invitation.max_additional_children` controls only unnamed/additional children.
- Invitation public credentials and check-in credentials are different bearer credentials.
- Credentials are deterministically derived server-side from a deployment secret, namespace, stable record id, and credential version.
- Plaintext public invitation and check-in credentials are not persisted.
- Public URLs must not expose sequential database IDs.
- Event eligibility is authoritative through `InvitationEvent`.
- Guests may RSVP only to events for which their invitation is eligible.
- `RSVPAttendee` represents current household attendee composition for the RSVP overall.
- `RSVPEventSelection` represents whether the household plans to attend one event and the expected household count for that event.
- Per-event expected counts may differ and do not identify exactly which named person attends which event in MVP.
- MVP check-in uses one active QR/pass per invitation/household, not one QR per attendee.
- `CheckinRecord` represents confirmed actual household attendance for one invitation and one event.
- Duplicate confirmed attendance is prevented by uniqueness on `Invitation + Event`.
- Accepted RSVP and CheckinPass state are created/updated atomically.
- Accepted to Declined revokes the active pass.
- Declined to Accepted issues a new pass; revoked passes are never reactivated.
- Admin product archiving preserves historical RSVP, messages, pass, check-in, and reporting data while denying public access and check-in.

## MVP Boundary

In scope:

- Personalized public invitation.
- Household/invitee management.
- Event eligibility.
- RSVP and dietary notes.
- Guest messages.
- Unique invitation links with deterministic regeneration.
- Accepted-RSVP household QR display.
- Event-aware QR/manual check-in.
- Admin dashboard.
- CSV/XLSX guest import with validation preview. Create-only, one household per source row, at most 500 rows and 5 MiB per upload.
- Basic reporting and CSV export.

Out of scope:

- Multi-tenant SaaS.
- Payments or gift registry.
- WhatsApp automation or email marketing.
- AI functionality.
- CMS/page builder.
- Drag-and-drop invitation designer.
- Multiple wedding themes.
- Microservices, Kafka, Redis, Elasticsearch, Kubernetes, or unnecessary cloud services.
- XLSX reporting/export in MVP.
- Raw invalid scan-attempt persistence in MVP.
- Multi-key credential-secret rotation infrastructure in MVP.

## Terminology

- Invitation: a household/group invitation with a public credential version and credential hash.
- Invitee: a named person known before RSVP.
- Event: a wedding event such as Holy Matrimony or Wedding Reception.
- InvitationEvent: the eligibility relationship between an Invitation and an Event.
- RSVP: the household response lifecycle with optimistic versioning.
- RSVPAttendee: current attendee composition for the RSVP overall; one row can reference a named Invitee or represent a permitted dynamic companion.
- RSVPEventSelection: one event-specific RSVP intent and expected count.
- CheckinPass: a household QR credential record issued after accepted RSVP.
- CheckinRecord: confirmed actual household attendance for one invitation and one event.
