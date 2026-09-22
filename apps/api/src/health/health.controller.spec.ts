import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../database/prisma.service.js";
import type { AppLogger } from "../logging/app-logger.js";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("returns the healthy response when the database check succeeds", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue(1),
    } as unknown as PrismaService;
    const logger = {
      error: vi.fn(),
    } as unknown as AppLogger;
    const controller = new HealthController(prisma, logger);

    await expect(controller.getHealth()).resolves.toEqual({
      status: "ok",
      api: "ok",
      database: "ok",
    });
  });

  it("logs sanitized database failures and throws a sanitized HTTP exception", async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockRejectedValue(
          new Error("postgres://user:password@host/db raw stack text"),
        ),
    } as unknown as PrismaService;
    const logger = {
      error: vi.fn(),
    } as unknown as AppLogger;
    const controller = new HealthController(prisma, logger);

    await expect(controller.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(logger.error).toHaveBeenCalledWith(
      {
        database: "unavailable",
        error: {
          name: "Error",
        },
      },
      "Database health check failed",
    );

    try {
      await controller.getHealth();
    } catch (error) {
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse()))
        .not.toContain("password");
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse()))
        .not.toContain("raw stack text");
    }
  });
});
