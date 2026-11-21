CREATE TYPE "rsvp_public_party_mode" AS ENUM ('ALONE', 'FAMILY', 'PLUS_ONE');

ALTER TABLE "rsvps"
ADD COLUMN "public_party_mode" "rsvp_public_party_mode";
