import { type DynamicModule, Module } from "@nestjs/common";
import type { ApiConfig } from "./config/api-config.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";

// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic module registration convention.
@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    const databaseModule = DatabaseModule.forRoot(config.DATABASE_URL);
    return {
      module: AppModule,
      imports: [HealthModule.register(databaseModule)],
    };
  }
}
