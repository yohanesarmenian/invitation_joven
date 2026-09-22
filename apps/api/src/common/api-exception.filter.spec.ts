import "reflect-metadata";
import { BadRequestException, Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiExceptionFilter } from "./api-exception.filter.js";

@Controller("test-errors")
class TestErrorsController {
  @Get("unexpected")
  unexpected() {
    throw new Error("raw database failure with stack and secret text");
  }

  @Get("validation")
  validation() {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      details: {
        field: "email",
      },
    });
  }
}

@Module({
  controllers: [TestErrorsController],
})
class TestErrorsModule {}

describe("ApiExceptionFilter", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      TestErrorsModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns a sanitized common envelope for unexpected errors", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/test-errors/unexpected",
      headers: {
        "x-request-id": "req-12345678",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        details: null,
      },
      requestId: "req-12345678",
      timestamp: expect.any(String),
    });
    expect(response.body).not.toContain("raw database failure");
    expect(response.body).not.toContain("stack");
    expect(response.body).not.toContain("secret text");
  });

  it("preserves known HTTP status and structured details", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/test-errors/validation",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: {
          field: "email",
        },
      },
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it.each([
    "/api/public/invitations/SUPER-SECRET-CREDENTIAL?token=QUERY-SECRET",
    "/api/public/checkin/SUPER-SECRET-CREDENTIAL?token=QUERY-SECRET",
    "/i/SUPER-SECRET-CREDENTIAL?token=QUERY-SECRET",
    "/c/SUPER-SECRET-CREDENTIAL?token=QUERY-SECRET",
  ])("sanitizes unmatched credential route responses for %s", async (url) => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url,
      headers: {
        "x-request-id": "req-credential404",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
        details: null,
      },
      requestId: "req-credential404",
      timestamp: expect.any(String),
    });
    expect(response.body).not.toContain("SUPER-SECRET-CREDENTIAL");
    expect(response.body).not.toContain("QUERY-SECRET");
    expect(response.body).not.toContain(url);
    expect(response.body).not.toContain(
      "Cannot GET /api/public/invitations/SUPER-SECRET-CREDENTIAL",
    );
  });

  it("returns a generic envelope for ordinary unmatched routes", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/completely-unknown-route",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
        details: null,
      },
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
    expect(response.body).not.toContain("Cannot GET");
    expect(response.body).not.toContain("/completely-unknown-route");
  });
});
