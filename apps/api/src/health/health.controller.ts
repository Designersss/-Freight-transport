import {
  Controller,
  Get,
  Inject,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthService } from "../auth/auth.module.js";
import { DatabaseService } from "../database/database.service.js";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(AuthService) private readonly auth?: AuthService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "getLiveness",
    summary: "Check API process liveness",
  })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", enum: ["ok"] } },
    },
  })
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({
    operationId: "getReadiness",
    summary: "Check database readiness",
  })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", enum: ["ready"] } },
    },
  })
  @ApiResponse({
    status: 503,
    description: "Database unavailable or migrations missing",
    schema: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "requestId"],
          properties: {
            code: { type: "string", enum: ["SERVICE_UNAVAILABLE"] },
            requestId: { type: "string" },
          },
        },
      },
    },
  })
  async readiness(): Promise<{ status: "ready" }> {
    try {
      await this.database.checkReadiness();
      await this.auth?.checkReadiness();
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
