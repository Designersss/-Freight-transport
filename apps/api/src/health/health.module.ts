import { type DynamicModule, Module } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { HealthController } from "./health.controller.js";

@Module({})
export class HealthModule {}

export function createHealthModule(databaseUrl: string): DynamicModule {
  return {
    module: HealthModule,
    controllers: [HealthController],
    providers: [
      {
        provide: DatabaseService,
        useFactory: () => new DatabaseService(databaseUrl),
      },
    ],
  };
}
