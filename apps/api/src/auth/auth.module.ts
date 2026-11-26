import {
  type AuthConfig,
  type AuthHttpRuntime,
  createAuthHttpRuntime,
} from "@freight/auth/runtime";
import {
  type DynamicModule,
  Module,
  type OnModuleDestroy,
} from "@nestjs/common";

export class AuthService implements OnModuleDestroy {
  private readonly runtime: AuthHttpRuntime;

  constructor(config: AuthConfig, databaseUrl: string) {
    this.runtime = createAuthHttpRuntime(config, databaseUrl);
  }

  handle(request: Request): Promise<Response> {
    return this.runtime.handle(request);
  }

  async onModuleDestroy(): Promise<void> {
    await this.runtime.close();
  }
}

@Module({})
export class AuthModule {
  static register(config: AuthConfig, databaseUrl: string): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        {
          provide: AuthService,
          useFactory: () => new AuthService(config, databaseUrl),
        },
      ],
      exports: [AuthService],
    };
  }
}
