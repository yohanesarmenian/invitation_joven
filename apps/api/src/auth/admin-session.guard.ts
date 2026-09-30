import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { AdminSessionService, type AuthenticatedAdminContext } from "./admin-session.service.js";

export type RequestWithAdminContext = {
  admin?: AuthenticatedAdminContext;
  headers?: Record<string, string | string[] | undefined>;
};

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    @Inject(AdminSessionService)
    private readonly sessionService: AdminSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdminContext>();
    const admin = await this.sessionService.authenticate(
      request.headers?.cookie,
    );
    request.admin = admin;

    return true;
  }
}

@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAdminContext>();

    if (request.admin === undefined) {
      return false;
    }

    return request.admin.user.role === "OWNER";
  }
}
