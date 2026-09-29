import { Injectable, Optional, type LoggerService } from "@nestjs/common";
import pino, { type Logger as PinoLogger } from "pino";
import { pinoRedactOptions } from "./redaction.js";

type NestLogLevel = "log" | "error" | "warn" | "debug" | "verbose" | "fatal";
type PinoLogLevel = "info" | "error" | "warn" | "debug" | "trace" | "fatal";

const LEVEL_MAP: Record<NestLogLevel, PinoLogLevel> = {
  log: "info",
  error: "error",
  warn: "warn",
  debug: "debug",
  verbose: "trace",
  fatal: "fatal",
};

const isProduction = process.env.NODE_ENV === "production";

@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: PinoLogger;

  constructor(@Optional() logger?: PinoLogger) {
    this.logger =
      logger ??
      pino({
        level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
        redact: pinoRedactOptions,
        timestamp: pino.stdTimeFunctions.isoTime,
      });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("log", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("verbose", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }

  getPinoLogger(): PinoLogger {
    return this.logger;
  }

  private write(
    nestLevel: NestLogLevel,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const pinoLevel = LEVEL_MAP[nestLevel];
    const context = this.getContext(optionalParams);
    const text = this.getText(optionalParams);

    if (typeof message === "object" && message !== null) {
      this.logger[pinoLevel](
        {
          ...(message as Record<string, unknown>),
          ...(context ? { context } : {}),
        },
        text,
      );
      return;
    }

    this.logger[pinoLevel](
      {
        ...(context ? { context } : {}),
      },
      String(message),
    );
  }

  private getText(optionalParams: unknown[]): string | undefined {
    const firstString = optionalParams.find(
      (parameter): parameter is string => typeof parameter === "string",
    );

    return firstString;
  }

  private getContext(optionalParams: unknown[]): string | undefined {
    const last = optionalParams.at(-1);

    return typeof last === "string" ? last : undefined;
  }
}
