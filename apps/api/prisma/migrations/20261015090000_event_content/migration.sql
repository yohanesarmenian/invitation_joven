CREATE TABLE "event_contents" (
  "event_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "draft" JSONB NOT NULL CHECK (jsonb_typeof("draft") = 'object'),
  "published" JSONB CHECK ("published" IS NULL OR jsonb_typeof("published") = 'object'),
  "published_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "event_contents_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "event_contents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "event_content_assets" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('IMAGE', 'PDF')),
  "mime_type" TEXT NOT NULL CHECK ("mime_type" IN ('image/png', 'application/pdf')),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" BETWEEN 1 AND 5242880),
  "bytes" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_content_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_content_assets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "event_content_assets_size_check" CHECK (octet_length("bytes") = "byte_size"),
  CONSTRAINT "event_content_assets_type_check" CHECK (("kind" = 'IMAGE' AND "mime_type" = 'image/png') OR ("kind" = 'PDF' AND "mime_type" = 'application/pdf'))
);
CREATE INDEX "event_content_assets_event_id_idx" ON "event_content_assets"("event_id");
