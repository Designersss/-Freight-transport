import {
  type AuthConfig,
  type AuthHttpRuntime,
  createAuthHttpRuntime,
  type StorageConfig,
} from "@freight/auth/runtime";
import {
  type DynamicModule,
  Module,
  type OnModuleDestroy,
} from "@nestjs/common";

export class AuthService implements OnModuleDestroy {
  private readonly runtime: AuthHttpRuntime;

  constructor(
    config: AuthConfig,
    databaseUrl: string,
    storage?: StorageConfig,
  ) {
    this.runtime = createAuthHttpRuntime(config, databaseUrl, storage);
  }

  handle(request: Request): Promise<Response> {
    return this.runtime.handle(request);
  }

  checkReadiness(): Promise<void> {
    return this.runtime.checkReadiness();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runtime.close();
  }
}

@Module({})
export class AuthModule {
  static register(
    config: AuthConfig,
    databaseUrl: string,
    storage?: StorageConfig,
  ): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        {
          provide: AuthService,
          useFactory: () => new AuthService(config, databaseUrl, storage),
        },
      ],
      exports: [AuthService],
    };
  }
}
