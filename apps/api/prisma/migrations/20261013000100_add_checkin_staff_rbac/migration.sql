ALTER TYPE "admin_role" ADD VALUE 'CHECKIN_STAFF';

ALTER TABLE "admin_users"
  ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false;
