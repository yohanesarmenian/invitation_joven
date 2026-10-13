import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminOriginService } from "../auth/admin-origin.service.js";
import {
  ADMIN_ALLOWED_ROLES_KEY,
} from "../auth/admin-roles.decorator.js";
import {
  AdminSessionService,
  type AuthenticatedAdminContext,
} from "../auth/admin-session.service.js";
import { AdminRole } from "../generated/prisma/client.js";
import { forbidden } from "../auth/auth-errors.js";

type HeaderValue = string | string[] | undefined;

export type RequestWithAdminContext = {
  admin?: AuthenticatedAdminContext;
  headers?: Record<string, HeaderValue>;
  method?: string;
  routeOptions?: {
    url?: string;
  };
  url?: string;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOGIN_ROUTE = "/api/admin/auth/login";
const PASSWORD_CHANGE_ALLOWED_ROUTES = new Set([
  "GET /api/admin/auth/me",
  "POST /api/admin/auth/logout",
  "POST /api/admin/auth/change-password",
]);

function normalizeRoutePath(request: RequestWithAdminContext): string {
  const path = request.routeOptions?.url ?? request.url ?? "";

  return path.split("?")[0] ?? path;
}

function getHeader(
  headers: Record<string, HeaderValue> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

@Injectable()
export class AdminSecurityGuard implements CanActivate {
  constructor(
    @Inject(AdminSessionService)
    private readonly sessionService: AdminSessionService,
    @Inject(AdminOriginService)
    private readonly originService: AdminOriginService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdminContext>();
    const method = request.method?.toUpperCase() ?? "GET";
    const path = normalizeRoutePath(request);

    if (!path.startsWith("/api/admin/")) {
      return true;
    }

    if (method === "POST" && path === LOGIN_ROUTE) {
      return true;
    }

    const admin = await this.sessionService.authenticate(
      request.headers?.cookie,
    );
    const allowedRoles =
      this.reflector.getAllAndOverride<readonly AdminRole[]>(
        ADMIN_ALLOWED_ROLES_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [AdminRole.OWNER];

    if (
      admin.user.mustChangePassword &&
      !PASSWORD_CHANGE_ALLOWED_ROUTES.has(`${method} ${path}`)
    ) {
      forbidden();
    }

    this.sessionService.assertRoles(admin, allowedRoles);
    request.admin = admin;

    if (!SAFE_METHODS.has(method)) {
      this.originService.assertValidAdminOrigin(request.headers ?? {});
      this.sessionService.assertCsrf(
        admin,
        getHeader(request.headers, "x-csrf-token"),
      );
    }

    return true;
  }
}
