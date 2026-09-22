import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { AppLogger } from "../logging/app-logger.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppLogger) private readonly logger: AppLogger,
  ) {}

  @Get()
  async getHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: "ok",
        api: "ok",
        database: "ok",
      };
    } catch (error) {
      this.logger.error(
        {
          database: "unavailable",
          error: {
            name: error instanceof Error ? error.name : "UnknownError",
          },
        },
        "Database health check failed",
      );

      throw new ServiceUnavailableException();
    }
  }
}
