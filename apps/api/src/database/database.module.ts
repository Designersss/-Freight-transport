import { type DynamicModule, Module } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";

// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic module registration convention.
@Module({})
export class DatabaseModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DatabaseService,
          useFactory: () => new DatabaseService(databaseUrl),
        },
      ],
      exports: [DatabaseService],
    };
  }
}
