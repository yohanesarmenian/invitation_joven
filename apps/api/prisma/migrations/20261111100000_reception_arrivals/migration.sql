ALTER TYPE "admin_role" ADD VALUE 'GUEST_MANAGER';

CREATE SEQUENCE public.invitation_reference_seq;
CREATE FUNCTION public.next_invitation_reference() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'HJ-' || lpad(n::text, greatest(6, length(n::text)), '0')
  FROM (SELECT nextval('public.invitation_reference_seq') AS n) allocated;
$$;
ALTER TABLE "invitations" ADD COLUMN "reference_code" TEXT DEFAULT public.next_invitation_reference();
ALTER TABLE "invitations" ALTER COLUMN "reference_code" SET NOT NULL;
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_reference_format" CHECK ("reference_code" ~ '^HJ-[0-9]{6,}$');
CREATE UNIQUE INDEX "invitations_reference_code_key" ON "invitations"("reference_code");
-- Built-in full-text indexes require no extension or elevated deployment role.
CREATE INDEX "invitation_reception_search" ON "invitations" USING GIN (to_tsvector('simple', coalesce("display_name", '') || ' ' || coalesce("greeting_name", '')));
CREATE INDEX "invitee_reception_search" ON "invitees" USING GIN (to_tsvector('simple', "full_name"));
ALTER TABLE "rsvp_change_events" ADD COLUMN "verification_method" TEXT;

CREATE TABLE "checkin_arrivals" (
  "id" UUID NOT NULL PRIMARY KEY,
  "operation_id" UUID NOT NULL,
  "checkin_record_id" UUID NOT NULL REFERENCES "checkin_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "invitation_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "attendee_count" INTEGER NOT NULL CHECK ("attendee_count" > 0),
  "expected_attendee_count" INTEGER NOT NULL,
  "total_after" INTEGER NOT NULL,
  "confirmed_by_admin_user_id" UUID NOT NULL REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actor_role" TEXT NOT NULL,
  "method" "checkin_method" NOT NULL,
  "checked_in_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verification_method" TEXT NOT NULL,
  "reason" TEXT,
  "payload_hash" TEXT NOT NULL,
  "migrated" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "arrival_capacity" CHECK ("total_after" >= "attendee_count" AND "expected_attendee_count" >= "total_after")
);
CREATE UNIQUE INDEX "checkin_arrivals_operation_id_key" ON "checkin_arrivals"("operation_id");
CREATE INDEX "checkin_arrivals_invitation_id_event_id_checked_in_at_idx" ON "checkin_arrivals"("invitation_id", "event_id", "checked_in_at");
-- One explicitly migrated representation per existing aggregate. No new arrival is asserted.
INSERT INTO "checkin_arrivals" (
  id, operation_id, checkin_record_id, invitation_id, event_id, attendee_count,
  expected_attendee_count, total_after, confirmed_by_admin_user_id, actor_role,
  method, checked_in_at, verification_method, payload_hash, migrated
)
SELECT gen_random_uuid(), c.id, c.id, c.invitation_id, c.event_id, c.attendee_count,
  greatest(c.attendee_count, coalesce(s.expected_attendee_count, 0)), c.attendee_count,
  c.confirmed_by_admin_user_id, u.role::text, c.method, c.checked_in_at,
  'MIGRATED_RECORD', 'migrated:' || c.id::text, true
FROM checkin_records c
JOIN admin_users u ON u.id = c.confirmed_by_admin_user_id
LEFT JOIN rsvps r ON r.invitation_id = c.invitation_id
LEFT JOIN rsvp_event_selections s ON s.rsvp_id = r.id AND s.event_id = c.event_id;

CREATE FUNCTION public.protect_checkin_arrivals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT pg_has_role(session_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RAISE EXCEPTION 'Arrival history is append-only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "arrival_immutable" BEFORE UPDATE OR DELETE ON "checkin_arrivals"
FOR EACH ROW EXECUTE FUNCTION public.protect_checkin_arrivals();
CREATE TRIGGER "arrival_no_truncate" BEFORE TRUNCATE ON "checkin_arrivals"
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_checkin_arrivals();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'invitation_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "checkin_arrivals" FROM invitation_app;
  END IF;
END $$;
