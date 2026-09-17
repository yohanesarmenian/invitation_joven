import {
  Controller,
  Get,
  Inject,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
        "Database health check failed",
        error instanceof Error ? error.stack : undefined,
      );

      throw new ServiceUnavailableException({
        status: "error",
        api: "ok",
        database: "unavailable",
      });
    }
  }
}
