ALTER TYPE "rsvp_attendee_type" ADD VALUE 'UNNAMED_COMPANION';
ALTER TABLE invitations ADD COLUMN unnamed_companion_allowance INTEGER NOT NULL DEFAULT 0 CHECK (unnamed_companion_allowance BETWEEN 0 AND 24);
-- Use text comparisons so the new enum value need not be consumed before commit.
ALTER TABLE rsvp_attendees DROP CONSTRAINT rsvp_attendees_type_reference_quantity_check;
ALTER TABLE rsvp_attendees ADD CONSTRAINT rsvp_attendees_type_reference_quantity_check CHECK (
 (attendee_type::text='NAMED_INVITEE' AND invitee_id IS NOT NULL AND quantity=1)
 OR (attendee_type::text='PLUS_ONE' AND invitee_id IS NULL AND quantity=1)
 OR (attendee_type::text IN ('ADDITIONAL_CHILD','UNNAMED_COMPANION') AND invitee_id IS NULL AND quantity>=1)
);
ALTER TABLE checkin_records DROP CONSTRAINT checkin_records_attendee_count_positive_check;
ALTER TABLE checkin_records ADD CONSTRAINT checkin_records_attendee_count_nonnegative_check CHECK (attendee_count>=0);
CREATE TABLE reception_actions (
 operation_id UUID PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('WALKIN','CORRECTION','EXCEPTION')),
 invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 operator_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 actor_role TEXT NOT NULL CHECK(actor_role IN ('OWNER','GUEST_MANAGER')),
 payload_hash TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
 verification_method TEXT NOT NULL, delta INTEGER NOT NULL DEFAULT 0,
 capacity_delta INTEGER NOT NULL DEFAULT 0 CHECK(capacity_delta BETWEEN 0 AND 5),
 method checkin_method NOT NULL DEFAULT 'MANUAL', created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, receipt JSONB NOT NULL,
 CONSTRAINT reception_action_accounting CHECK (
 (kind='WALKIN' AND delta=0 AND capacity_delta=0) OR
 (kind='CORRECTION' AND delta<>0 AND capacity_delta=0) OR
 (kind='EXCEPTION' AND delta=0 AND capacity_delta>0 AND method='MANUAL'))
);
CREATE INDEX reception_actions_invitation_id_event_id_created_at_idx ON reception_actions(invitation_id,event_id,created_at);
CREATE INDEX reception_actions_operator_id_created_at_idx ON reception_actions(operator_id,created_at);
CREATE TABLE walkin_registrations (
 id UUID PRIMARY KEY, invitation_id UUID NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 operation_id UUID NOT NULL UNIQUE REFERENCES reception_actions(operation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 lead_name TEXT NOT NULL, companion_count INTEGER NOT NULL CHECK(companion_count BETWEEN 0 AND 24),
 expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 25),
 arriving_count INTEGER NOT NULL CHECK(arriving_count BETWEEN 1 AND expected_count),
 affiliation TEXT NOT NULL, duplicate_override_reason TEXT, reviewed_match_ids JSONB NOT NULL,
 CONSTRAINT walkin_companion_count CHECK(companion_count=expected_count-1)
);
-- Reuse the Phase 4C session-user/table-owner maintenance boundary.
CREATE TRIGGER reception_action_immutable BEFORE UPDATE OR DELETE ON reception_actions FOR EACH ROW EXECUTE FUNCTION public.protect_checkin_arrivals();
CREATE TRIGGER reception_action_no_truncate BEFORE TRUNCATE ON reception_actions FOR EACH STATEMENT EXECUTE FUNCTION public.protect_checkin_arrivals();
CREATE TRIGGER walkin_immutable BEFORE UPDATE OR DELETE ON walkin_registrations FOR EACH ROW EXECUTE FUNCTION public.protect_checkin_arrivals();
CREATE TRIGGER walkin_no_truncate BEFORE TRUNCATE ON walkin_registrations FOR EACH STATEMENT EXECUTE FUNCTION public.protect_checkin_arrivals();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='invitation_app') THEN
 REVOKE UPDATE,DELETE,TRUNCATE ON reception_actions,walkin_registrations FROM invitation_app;
END IF; END $$;
