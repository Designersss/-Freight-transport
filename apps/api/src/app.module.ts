import type { AuthConfig, StorageConfig } from "@freight/auth/runtime";
import { type DynamicModule, Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import type { ApiConfig } from "./config/api-config.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({})
export class AppModule {
  static register(
    config: ApiConfig,
    auth?: AuthConfig,
    storage?: StorageConfig,
  ): DynamicModule {
    const databaseModule = DatabaseModule.forRoot(config.DATABASE_URL);
    return {
      module: AppModule,
      imports: [
        HealthModule.register(databaseModule),
        ...(auth
          ? [AuthModule.register(auth, config.DATABASE_URL, storage)]
          : []),
      ],
    };
  }
}
