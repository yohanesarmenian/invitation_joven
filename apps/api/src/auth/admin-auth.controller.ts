import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiBody,
  ApiTags,
} from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../common/api-error.dto.js";
import type { RequestWithAdminContext } from "../common/admin-security.guard.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { AdminOriginService } from "./admin-origin.service.js";
import {
  AdminSessionService,
  type AuthenticatedAdminContext,
} from "./admin-session.service.js";
import { AdminCookieService } from "./cookie.service.js";
import {
  AdminAuthResponseDto,
  AdminLoginRequestDto,
  mapAdminLoginRequest,
} from "./dto/admin-auth.dto.js";

type HeaderBag = Record<string, string | string[] | undefined>;
type FastifyReplyLike = {
  header: (name: string, value: string) => void;
};

@ApiTags("Admin Auth")
@Controller("api/admin/auth")
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly authService: AdminAuthService,
    @Inject(AdminSessionService)
    private readonly sessionService: AdminSessionService,
    @Inject(AdminOriginService) private readonly originService: AdminOriginService,
    @Inject(AdminCookieService) private readonly cookieService: AdminCookieService,
  ) {}

  private async getAdminContext(
    request: RequestWithAdminContext,
    cookie: string | string[] | undefined,
  ): Promise<AuthenticatedAdminContext> {
    return request.admin ?? this.sessionService.authenticate(cookie);
  }

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Admin login" })
  @ApiBody({ type: AdminLoginRequestDto })
  @ApiOkResponse({ type: AdminAuthResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelopeDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorEnvelopeDto })
  async login(
    @Headers() headers: HeaderBag,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReplyLike,
  ): Promise<AdminAuthResponseDto> {
    this.originService.assertValidAdminOrigin(headers);
    const result = await this.authService.login(mapAdminLoginRequest(body));
    reply.header(
      "set-cookie",
      this.cookieService.serializeSessionCookie(
        result.sessionToken,
        new Date(result.response.session.expiresAt),
      ),
    );

    return result.response;
  }

  @Get("me")
  @ApiOperation({ summary: "Get current admin session" })
  @ApiOkResponse({ type: AdminAuthResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  async me(
    @Req() request: RequestWithAdminContext,
    @Headers("cookie") cookie: string | string[] | undefined,
  ): Promise<AdminAuthResponseDto> {
    const context = await this.getAdminContext(request, cookie);
    this.sessionService.assertOwner(context);

    return {
      csrfToken: context.csrfToken,
      session: {
        expiresAt: context.session.expiresAt.toISOString(),
      },
      user: {
        email: context.user.email,
        id: context.user.id,
        role: context.user.role,
      },
    };
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Log out current admin session" })
  @ApiNoContentResponse({ description: "Logged out." })
  @ApiUnauthorizedResponse({ type: ApiErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ApiErrorEnvelopeDto })
  async logout(
    @Req() request: RequestWithAdminContext,
    @Headers() headers: HeaderBag,
    @Headers("cookie") cookie: string | string[] | undefined,
    @Headers("x-csrf-token") csrfToken: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReplyLike,
  ): Promise<void> {
    const context = await this.getAdminContext(request, cookie);
    this.sessionService.assertOwner(context);
    this.originService.assertValidAdminOrigin(headers);
    this.sessionService.assertCsrf(context, csrfToken);
    await this.sessionService.revokeCurrentSession(context.session.id);
    reply.header("set-cookie", this.cookieService.serializeClearedSessionCookie());
  }
}
