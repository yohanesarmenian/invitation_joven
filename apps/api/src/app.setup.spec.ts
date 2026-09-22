import { describe, expect, it, vi } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { configureApp } from "./app.setup.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";

describe("configureApp", () => {
  it("uses the configured logger, global API error filter, and shutdown hooks", () => {
    const app = {
      get: vi.fn(() => ({ info: vi.fn() })),
      getHttpAdapter: vi.fn(() => ({
        getInstance: vi.fn(() => ({
          addHook: vi.fn(),
        })),
      })),
      useLogger: vi.fn(),
      useGlobalFilters: vi.fn(),
      enableShutdownHooks: vi.fn(),
    } as unknown as NestFastifyApplication;

    configureApp(app);

    expect(app.useLogger).toHaveBeenCalledOnce();
    expect(app.useGlobalFilters).toHaveBeenCalledWith(
      expect.any(ApiExceptionFilter),
    );
    expect(app.enableShutdownHooks).toHaveBeenCalledOnce();
  });
});
