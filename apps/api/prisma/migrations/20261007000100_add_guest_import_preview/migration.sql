-- CreateEnum
CREATE TYPE "guest_import_preview_status" AS ENUM ('PENDING', 'COMMITTED');

-- CreateTable
CREATE TABLE "guest_import_previews" (
    "id" UUID NOT NULL,
    "created_by_admin_user_id" UUID NOT NULL,
    "committed_batch_id" UUID,
    "source_format" "guest_import_source_format" NOT NULL,
    "sanitized_source_filename" TEXT NOT NULL,
    "source_digest" TEXT NOT NULL,
    "normalized_rows" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "status" "guest_import_preview_status" NOT NULL DEFAULT 'PENDING',
    "commit_fingerprint" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guest_import_previews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_import_previews_committed_batch_id_key" ON "guest_import_previews"("committed_batch_id");

-- CreateIndex
CREATE INDEX "guest_import_previews_created_by_admin_user_id_idx" ON "guest_import_previews"("created_by_admin_user_id");

-- CreateIndex
CREATE INDEX "guest_import_previews_expires_at_idx" ON "guest_import_previews"("expires_at");

-- AddForeignKey
ALTER TABLE "guest_import_previews" ADD CONSTRAINT "guest_import_previews_created_by_admin_user_id_fkey" FOREIGN KEY ("created_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_import_previews" ADD CONSTRAINT "guest_import_previews_committed_batch_id_fkey" FOREIGN KEY ("committed_batch_id") REFERENCES "guest_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
