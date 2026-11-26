import { type DynamicModule, Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic module registration convention.
@Module({ controllers: [HealthController] })
export class HealthModule {
  static register(databaseModule: DynamicModule): DynamicModule {
    return { module: HealthModule, imports: [databaseModule] };
  }
}
