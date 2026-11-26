CREATE TABLE "user_event_streams" (
    "user_id" TEXT NOT NULL,
    "last_sequence" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "user_event_streams_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_event_streams_sequence_check" CHECK ("last_sequence" >= 0)
);

CREATE TABLE "user_event_invalidations" (
    "user_id" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    CONSTRAINT "user_event_invalidations_pkey" PRIMARY KEY ("user_id", "sequence"),
    CONSTRAINT "user_event_invalidations_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "user_event_invalidations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_event_streams"("user_id") ON DELETE CASCADE ON UPDATE CASCADE
);
