import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ensureRequestId, REQUEST_ID_HEADER } from "../common/request-id.js";
import { AppLogger } from "./app-logger.js";
import { sanitizeRequestUrl } from "./redaction.js";

type HookDone = (error?: Error) => void;

type FastifyLikeRequest = {
  id?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
};

type FastifyLikeReply = {
  statusCode?: number;
  elapsedTime?: number;
  header: (name: string, value: string) => void;
};

type FastifyLikeInstance = {
  addHook: (
    hook: "onRequest" | "onResponse" | "onError",
    handler: (
      request: FastifyLikeRequest,
      reply: FastifyLikeReply,
      done: HookDone,
    ) => void,
  ) => void;
};

export function registerRequestLogging(
  app: NestFastifyApplication,
  logger: AppLogger,
): void {
  const fastify = app.getHttpAdapter().getInstance() as FastifyLikeInstance;

  fastify.addHook("onRequest", (request, reply, done) => {
    const requestId = ensureRequestId(request);
    reply.header(REQUEST_ID_HEADER, requestId);
    done();
  });

  fastify.addHook("onResponse", (request, reply, done) => {
    logger.info(
      {
        requestId: ensureRequestId(request),
        method: request.method,
        url: sanitizeRequestUrl(request.url),
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "request completed",
    );
    done();
  });
}
