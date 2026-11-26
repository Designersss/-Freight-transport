import { createDatabaseClient, type DatabaseClient } from "@freight/database";
import type { OnModuleDestroy } from "@nestjs/common";

export class DatabaseService implements OnModuleDestroy {
  private readonly client: DatabaseClient;

  constructor(databaseUrl: string) {
    this.client = createDatabaseClient(databaseUrl);
  }

  async checkReadiness(): Promise<void> {
    // A query against a migrated table checks credentials, connectivity and schema availability.
    await this.client.outboxEvent.findFirst({ select: { id: true } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
