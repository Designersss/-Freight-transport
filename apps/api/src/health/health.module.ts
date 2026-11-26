import { type DynamicModule, Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

@Module({ controllers: [HealthController] })
export class HealthModule {
  static register(databaseModule: DynamicModule): DynamicModule {
    return { module: HealthModule, imports: [databaseModule] };
  }
}
