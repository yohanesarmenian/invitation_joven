import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { sanitizeRequestUrl } from "../logging/redaction.js";
import { ensureRequestId } from "./request-id.js";

type ErrorDetails = Record<string, unknown> | unknown[] | null;

type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details: ErrorDetails;
  };
  requestId: string;
  timestamp: string;
};

type HttpExceptionResponse = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
};

type RequestWithId = {
  id?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
};

type HttpReply = {
  status: (statusCode: number) => {
    send: (body: ApiErrorEnvelope) => void;
  };
};

const STATUS_ERROR_CODES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "UNPROCESSABLE_ENTITY",
  [HttpStatus.TOO_MANY_REQUESTS]: "TOO_MANY_REQUESTS",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "INTERNAL_ERROR",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
};

const STATUS_MESSAGES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: "Bad request",
  [HttpStatus.UNAUTHORIZED]: "Unauthorized",
  [HttpStatus.FORBIDDEN]: "Forbidden",
  [HttpStatus.NOT_FOUND]: "Not found",
  [HttpStatus.CONFLICT]: "Conflict",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "Unprocessable entity",
  [HttpStatus.TOO_MANY_REQUESTS]: "Too many requests",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "Internal server error",
  [HttpStatus.SERVICE_UNAVAILABLE]: "Service unavailable",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<HttpReply>();
    const status = this.getStatus(exception);
    const requestId = ensureRequestId(request);
    const error = this.getError(exception, status);
    const body: ApiErrorEnvelope = {
      error,
      requestId,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error({
        requestId,
        statusCode: status,
        method: request.method,
        url: sanitizeRequestUrl(request.url),
        error: {
          name: exception instanceof Error ? exception.name : "UnknownError",
        },
      });
    }

    response.status(status).send(body);
  }

  private getStatus(exception: unknown): HttpStatus {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getError(
    exception: unknown,
    status: HttpStatus,
  ): ApiErrorEnvelope["error"] {
    const response =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const responseBody =
      typeof response === "object" && response !== null
        ? (response as HttpExceptionResponse)
        : undefined;
    const exposeResponse = status < 500;

    return {
      code:
        typeof responseBody?.code === "string" && exposeResponse
          ? responseBody.code
          : (STATUS_ERROR_CODES[status] ?? "INTERNAL_ERROR"),
      message: this.getMessage(response, responseBody, status, exposeResponse),
      details:
        responseBody?.details !== undefined && exposeResponse
          ? this.getDetails(responseBody.details)
          : null,
    };
  }

  private getMessage(
    response: string | object | undefined,
    responseBody: HttpExceptionResponse | undefined,
    status: HttpStatus,
    exposeResponse: boolean,
  ): string {
    if (!exposeResponse) {
      return STATUS_MESSAGES[status] ?? "Internal server error";
    }

    if (typeof responseBody?.message === "string") {
      return responseBody.message;
    }

    if (Array.isArray(responseBody?.message)) {
      return "Request validation failed.";
    }

    if (typeof response === "string") {
      return response;
    }

    return STATUS_MESSAGES[status] ?? "Internal server error";
  }

  private getDetails(details: unknown): ErrorDetails {
    if (Array.isArray(details)) {
      return details;
    }

    if (typeof details === "object" && details !== null) {
      return details as Record<string, unknown>;
    }

    return null;
  }
}
