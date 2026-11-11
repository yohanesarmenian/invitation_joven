-- Add history for new successful changes. Existing RSVP rows remain untouched.
CREATE TABLE "rsvp_change_events" (
  "id" UUID NOT NULL,
  "rsvp_id" UUID NOT NULL,
  "invitation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action" TEXT NOT NULL,
  "actor_category" TEXT NOT NULL,
  "actor_role" TEXT,
  "actor_admin_user_id" UUID,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "previous_values" JSONB,
  "updated_values" JSONB NOT NULL,
  "changes" JSONB NOT NULL,
  "override_reason" TEXT,
  CONSTRAINT "rsvp_change_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rsvp_change_events_action_check" CHECK (length("action") BETWEEN 1 AND 80),
  CONSTRAINT "rsvp_change_events_actor_check" CHECK (length("actor_category") BETWEEN 1 AND 80),
  CONSTRAINT "rsvp_change_events_values_check" CHECK (
    ("previous_values" IS NULL OR jsonb_typeof("previous_values") = 'object')
    AND jsonb_typeof("updated_values") = 'object'
    AND jsonb_typeof("changes") = 'array'
  ),
  CONSTRAINT "rsvp_change_events_rsvp_id_fkey" FOREIGN KEY ("rsvp_id") REFERENCES "rsvps"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rsvp_change_events_actor_admin_user_id_fkey" FOREIGN KEY ("actor_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rsvp_change_events_rsvp_id_revision_key" ON "rsvp_change_events"("rsvp_id", "revision");
CREATE INDEX "rsvp_change_events_invitation_id_created_at_idx" ON "rsvp_change_events"("invitation_id", "created_at");

-- Only the table owner (migration/maintenance identity) may rewrite history.
-- session_user also protects against deletion through a parent cascade.
CREATE FUNCTION public.protect_rsvp_change_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT pg_has_role(session_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER') THEN
    RAISE EXCEPTION 'RSVP change history is append-only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "rsvp_change_history_immutable" BEFORE UPDATE OR DELETE ON "rsvp_change_events"
FOR EACH ROW EXECUTE FUNCTION public.protect_rsvp_change_history();
CREATE TRIGGER "rsvp_change_history_no_truncate" BEFORE TRUNCATE ON "rsvp_change_events"
FOR EACH STATEMENT EXECUTE FUNCTION public.protect_rsvp_change_history();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'invitation_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "rsvp_change_events" FROM invitation_app;
  END IF;
END $$;
