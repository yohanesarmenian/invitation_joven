-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('OWNER');

-- CreateEnum
CREATE TYPE "admin_user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "invitee_category" AS ENUM ('ADULT', 'CHILD');

-- CreateEnum
CREATE TYPE "rsvp_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "rsvp_attendee_type" AS ENUM ('NAMED_INVITEE', 'PLUS_ONE', 'ADDITIONAL_CHILD');

-- CreateEnum
CREATE TYPE "checkin_pass_status" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "checkin_method" AS ENUM ('QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "guest_import_source_format" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "guest_import_status" AS ENUM ('COMMITTED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'OWNER',
    "status" "admin_user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "csrf_token_hash" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),
    "user_agent" TEXT,
    "ip_address" INET,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "greeting_name" TEXT,
    "public_token_version" INTEGER NOT NULL DEFAULT 1,
    "public_token_hash" TEXT NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'ACTIVE',
    "rsvp_deadline_at" TIMESTAMPTZ(6),
    "allow_plus_one" BOOLEAN NOT NULL DEFAULT false,
    "max_additional_children" INTEGER NOT NULL DEFAULT 0,
    "first_opened_at" TIMESTAMPTZ(6),
    "last_opened_at" TIMESTAMPTZ(6),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitees" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "category" "invitee_category" NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "venue_name" TEXT,
    "address" TEXT,
    "google_maps_url" TEXT,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_events" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rsvps" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "submitted_by_admin_user_id" UUID,
    "status" "rsvp_status" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "dietary_notes" TEXT,
    "guest_note" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admin_override_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rsvps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rsvp_event_selections" (
    "id" UUID NOT NULL,
    "rsvp_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "attending" BOOLEAN NOT NULL,
    "expected_attendee_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rsvp_event_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rsvp_attendees" (
    "id" UUID NOT NULL,
    "rsvp_id" UUID NOT NULL,
    "invitee_id" UUID,
    "attendee_type" "rsvp_attendee_type" NOT NULL,
    "display_name" TEXT,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rsvp_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_messages" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "author_name" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "guest_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_passes" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "rsvp_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "status" "checkin_pass_status" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_records" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "checkin_pass_id" UUID,
    "confirmed_by_admin_user_id" UUID NOT NULL,
    "method" "checkin_method" NOT NULL,
    "attendee_count" INTEGER NOT NULL,
    "checked_in_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "checkin_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_import_batches" (
    "id" UUID NOT NULL,
    "committed_by_admin_user_id" UUID NOT NULL,
    "source_filename" TEXT NOT NULL,
    "source_format" "guest_import_source_format" NOT NULL,
    "status" "guest_import_status" NOT NULL DEFAULT 'COMMITTED',
    "row_count" INTEGER NOT NULL,
    "created_invitation_count" INTEGER NOT NULL,
    "created_invitee_count" INTEGER NOT NULL,
    "warning_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "committed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_session_token_hash_key" ON "admin_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin_sessions"("admin_user_id");

-- CreateIndex
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_public_token_hash_key" ON "invitations"("public_token_hash");

-- CreateIndex
CREATE INDEX "invitations_status_idx" ON "invitations"("status");

-- CreateIndex
CREATE INDEX "invitees_invitation_id_idx" ON "invitees"("invitation_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitees_invitation_id_display_order_key" ON "invitees"("invitation_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "events_display_order_key" ON "events"("display_order");

-- CreateIndex
CREATE INDEX "invitation_events_event_id_idx" ON "invitation_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_events_invitation_id_event_id_key" ON "invitation_events"("invitation_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "rsvps_invitation_id_key" ON "rsvps"("invitation_id");

-- CreateIndex
CREATE INDEX "rsvps_status_idx" ON "rsvps"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rsvp_event_selections_rsvp_id_event_id_key" ON "rsvp_event_selections"("rsvp_id", "event_id");

-- CreateIndex
CREATE INDEX "rsvp_attendees_rsvp_id_idx" ON "rsvp_attendees"("rsvp_id");

-- CreateIndex
CREATE INDEX "rsvp_attendees_invitee_id_idx" ON "rsvp_attendees"("invitee_id");

-- CreateIndex
CREATE INDEX "guest_messages_invitation_id_idx" ON "guest_messages"("invitation_id");

-- CreateIndex
CREATE INDEX "guest_messages_created_at_idx" ON "guest_messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_passes_token_hash_key" ON "checkin_passes"("token_hash");

-- CreateIndex
CREATE INDEX "checkin_passes_invitation_id_idx" ON "checkin_passes"("invitation_id");

-- CreateIndex
CREATE INDEX "checkin_passes_rsvp_id_idx" ON "checkin_passes"("rsvp_id");

-- CreateIndex
CREATE INDEX "checkin_records_event_id_idx" ON "checkin_records"("event_id");

-- CreateIndex
CREATE INDEX "checkin_records_checkin_pass_id_idx" ON "checkin_records"("checkin_pass_id");

-- CreateIndex
CREATE INDEX "checkin_records_checked_in_at_idx" ON "checkin_records"("checked_in_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_records_invitation_id_event_id_key" ON "checkin_records"("invitation_id", "event_id");

-- CreateIndex
CREATE INDEX "guest_import_batches_committed_at_idx" ON "guest_import_batches"("committed_at");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_events" ADD CONSTRAINT "invitation_events_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_events" ADD CONSTRAINT "invitation_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_submitted_by_admin_user_id_fkey" FOREIGN KEY ("submitted_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_event_selections" ADD CONSTRAINT "rsvp_event_selections_rsvp_id_fkey" FOREIGN KEY ("rsvp_id") REFERENCES "rsvps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_event_selections" ADD CONSTRAINT "rsvp_event_selections_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_attendees" ADD CONSTRAINT "rsvp_attendees_rsvp_id_fkey" FOREIGN KEY ("rsvp_id") REFERENCES "rsvps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvp_attendees" ADD CONSTRAINT "rsvp_attendees_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "invitees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_passes" ADD CONSTRAINT "checkin_passes_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_passes" ADD CONSTRAINT "checkin_passes_rsvp_id_fkey" FOREIGN KEY ("rsvp_id") REFERENCES "rsvps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_checkin_pass_id_fkey" FOREIGN KEY ("checkin_pass_id") REFERENCES "checkin_passes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_confirmed_by_admin_user_id_fkey" FOREIGN KEY ("confirmed_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_import_batches" ADD CONSTRAINT "guest_import_batches_committed_by_admin_user_id_fkey" FOREIGN KEY ("committed_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom constraints required by the locked domain model.
-- These are intentionally kept in SQL because Prisma schema syntax cannot
-- express PostgreSQL partial unique indexes or these conditional row checks.

-- Invitation aggregate and credential counters.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_public_token_version_positive_check" CHECK ("public_token_version" >= 1);
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_max_additional_children_nonnegative_check" CHECK ("max_additional_children" >= 0);
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_open_count_nonnegative_check" CHECK ("open_count" >= 0);

-- Stable display ordering/count checks.
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_display_order_nonnegative_check" CHECK ("display_order" >= 0);
ALTER TABLE "events" ADD CONSTRAINT "events_display_order_nonnegative_check" CHECK ("display_order" >= 0);

-- RSVP optimistic versioning and per-event row-local attendance semantics.
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_version_positive_check" CHECK ("version" >= 1);
ALTER TABLE "rsvp_event_selections" ADD CONSTRAINT "rsvp_event_selections_expected_attendee_count_nonnegative_check" CHECK ("expected_attendee_count" >= 0);
ALTER TABLE "rsvp_event_selections" ADD CONSTRAINT "rsvp_event_selections_attending_count_check" CHECK (
    ("attending" = false AND "expected_attendee_count" = 0)
    OR ("attending" = true AND "expected_attendee_count" >= 1)
);

-- RSVP attendee type/reference/quantity ownership.
ALTER TABLE "rsvp_attendees" ADD CONSTRAINT "rsvp_attendees_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "rsvp_attendees" ADD CONSTRAINT "rsvp_attendees_type_reference_quantity_check" CHECK (
    (
        "attendee_type" = 'NAMED_INVITEE'
        AND "invitee_id" IS NOT NULL
        AND "quantity" = 1
    )
    OR (
        "attendee_type" = 'PLUS_ONE'
        AND "invitee_id" IS NULL
        AND "quantity" = 1
    )
    OR (
        "attendee_type" = 'ADDITIONAL_CHILD'
        AND "invitee_id" IS NULL
        AND "quantity" >= 1
    )
);

CREATE UNIQUE INDEX "rsvp_attendees_one_named_invitee_per_rsvp_idx"
    ON "rsvp_attendees"("rsvp_id", "invitee_id")
    WHERE "invitee_id" IS NOT NULL;

CREATE UNIQUE INDEX "rsvp_attendees_one_plus_one_per_rsvp_idx"
    ON "rsvp_attendees"("rsvp_id")
    WHERE "attendee_type" = 'PLUS_ONE';

-- Check-in pass lifecycle uniqueness and positive credential version.
ALTER TABLE "checkin_passes" ADD CONSTRAINT "checkin_passes_credential_version_positive_check" CHECK ("credential_version" >= 1);

CREATE UNIQUE INDEX "checkin_passes_one_active_per_invitation_idx"
    ON "checkin_passes"("invitation_id")
    WHERE "status" = 'ACTIVE';

-- Confirmed attendance row-local constraints.
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_attendee_count_positive_check" CHECK ("attendee_count" >= 1);
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_qr_requires_pass_check" CHECK (
    "method" <> 'QR'
    OR "checkin_pass_id" IS NOT NULL
);

-- Successful import provenance counters.
ALTER TABLE "guest_import_batches" ADD CONSTRAINT "guest_import_batches_counts_nonnegative_check" CHECK (
    "row_count" >= 0
    AND "created_invitation_count" >= 0
    AND "created_invitee_count" >= 0
    AND "warning_count" >= 0
    AND "error_count" >= 0
);
