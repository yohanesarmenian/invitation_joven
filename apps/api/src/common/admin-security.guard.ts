import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { AdminOriginService } from "../auth/admin-origin.service.js";
import {
  AdminSessionService,
  type AuthenticatedAdminContext,
} from "../auth/admin-session.service.js";

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
    this.sessionService.assertOwner(admin);
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
