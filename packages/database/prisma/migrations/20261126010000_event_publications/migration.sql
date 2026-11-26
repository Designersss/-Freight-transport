CREATE TABLE "event_publications" (
    "event_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_publications_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "event_publications_published_idx" ON "event_publications"("published_at", "event_id");

ALTER TABLE "event_publications" ADD CONSTRAINT "event_publications_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
