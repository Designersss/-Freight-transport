import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get()
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async readiness(): Promise<{ status: "ready" }> {
    try {
      await this.database.checkReadiness();
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
