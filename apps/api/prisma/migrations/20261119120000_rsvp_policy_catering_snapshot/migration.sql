CREATE TABLE "wedding_rsvp_policy" (
    "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "initial_deadline_at" TIMESTAMPTZ(6),
    "allow_late_edits" BOOLEAN NOT NULL DEFAULT FALSE,
    "final_edit_deadline_at" TIMESTAMPTZ(6),
    CONSTRAINT "wedding_rsvp_policy_final_deadline" CHECK (
      "final_edit_deadline_at" IS NULL OR
      ("allow_late_edits" AND "initial_deadline_at" IS NOT NULL
        AND "final_edit_deadline_at" >= "initial_deadline_at")
    )
);

INSERT INTO "wedding_rsvp_policy" ("id") VALUES (1);

CREATE TABLE "catering_snapshots" (
    "version" INTEGER PRIMARY KEY CHECK ("version" > 0),
    "operation_id" UUID NOT NULL UNIQUE,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "captured_by_id" UUID NOT NULL REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "schema_version" INTEGER NOT NULL DEFAULT 1 CHECK ("schema_version" > 0),
    "payload" JSONB NOT NULL
);

-- Runtime can create versions. Historical versions can only be maintained
-- by the separate table owner.
CREATE FUNCTION "protect_catering_snapshot"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
    RAISE EXCEPTION 'Catering snapshots are immutable' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "catering_snapshots_immutable_rows"
BEFORE UPDATE OR DELETE ON "catering_snapshots" FOR EACH ROW
EXECUTE FUNCTION "protect_catering_snapshot"();

CREATE TRIGGER "catering_snapshots_immutable_truncate"
BEFORE TRUNCATE ON "catering_snapshots" FOR EACH STATEMENT
EXECUTE FUNCTION "protect_catering_snapshot"();
