import { createDatabaseClient, type DatabaseClient } from "@freight/database";
import type { OnModuleDestroy } from "@nestjs/common";

export class DatabaseService implements OnModuleDestroy {
  private readonly client: DatabaseClient;

  constructor(databaseUrl: string) {
    this.client = createDatabaseClient(databaseUrl);
  }

  async checkReadiness(): Promise<void> {
    // Resolve every foundation column without reading business records.
    await this.client.$queryRaw`
      SELECT e.id, e.event_type, e.aggregate_id, e.payload, e.created_at,
             e.processed_at, e.attempts, p.event_id, p.published_at,
             s.user_id, s.last_sequence, i.user_id, i.sequence
      FROM outbox_events e
      CROSS JOIN event_publications p
      CROSS JOIN user_event_streams s
      CROSS JOIN user_event_invalidations i
      LIMIT 0
    `;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
