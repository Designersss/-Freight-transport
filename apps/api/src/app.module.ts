import { type DynamicModule, Module } from "@nestjs/common";
import type { ApiConfig } from "./config/api-config.js";
import { createHealthModule } from "./health/health.module.js";

@Module({})
export class AppModule {}

export function createAppModule(config: ApiConfig): DynamicModule {
  return {
    module: AppModule,
    imports: [createHealthModule(config.DATABASE_URL)],
  };
}
