import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";

export function validationError(): never {
  throw new BadRequestException({
    code: "VALIDATION_ERROR",
    details: null,
    message: "Validation error",
  });
}

export function invalidCredentials(): never {
  throw new UnauthorizedException({
    code: "INVALID_CREDENTIALS",
    details: null,
    message: "Invalid credentials",
  });
}

export function tooManyLoginAttempts(): never {
  throw new HttpException(
    {
      code: "TOO_MANY_LOGIN_ATTEMPTS",
      details: null,
      message: "Too many login attempts",
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

export function unauthenticated(): never {
  throw new UnauthorizedException({
    code: "UNAUTHENTICATED",
    details: null,
    message: "Unauthenticated",
  });
}

export function forbidden(): never {
  throw new ForbiddenException({
    code: "FORBIDDEN",
    details: null,
    message: "Forbidden",
  });
}

export function csrfInvalid(): never {
  throw new ForbiddenException({
    code: "CSRF_INVALID",
    details: null,
    message: "CSRF invalid",
  });
}
