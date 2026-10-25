import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, Public } from "@ticketing/auth-guard";
import type { AuthUser } from "@ticketing/auth-guard";
import type { Request, Response } from "express";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { GoogleService } from "./google.service";
import { GoogleStartDto } from "./auth.responses";

@ApiTags("auth")
@Controller("auth/google")
export class GoogleController {
  constructor(
    private readonly google: GoogleService,
    @Inject(ENV) private readonly env: Env,
  ) {}
  private async begin(res: Response, linkUserId?: string) {
    const result = await this.google.begin(linkUserId);
    res.setHeader("Cache-Control", "no-store");
    res.cookie("ventix_oauth", result.cookie, {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600_000,
    });
    return { authorization_url: result.authorization_url };
  }
  @Get("start")
  @ApiOkResponse({ type: GoogleStartDto })
  @Public()
  @ApiOperation({ summary: "Khởi tạo Google OAuth PKCE; trả URL và cookie state" })
  start(@Res({ passthrough: true }) res: Response) {
    return this.begin(res);
  }

  @Get("link")
  @ApiOkResponse({ type: GoogleStartDto })
  @ApiBearerAuth()
  @ApiOperation({ summary: "Liên kết Google với tài khoản đã đăng nhập" })
  link(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    return this.begin(res, user.userId);
  }

  @Get("callback")
  @ApiQuery({ name: "state", required: true, type: String })
  @ApiQuery({ name: "code", required: true, type: String })
  @ApiResponse({
    status: 302,
    description: "Refresh cookie và redirect về frontend, không có token trong URL",
    headers: { Location: { schema: { type: "string" } } },
  })
  @Public()
  @ApiOperation({ summary: "Nhận code/state từ Google; đặt phiên rồi về frontend" })
  async callback(
    @Query("state") state: unknown,
    @Query("code") code: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookie =
      req.headers.cookie
        ?.split(";")
        .map((p) => p.trim())
        .find((p) => p.startsWith("ventix_oauth="))
        ?.slice("ventix_oauth=".length) ?? "";
    let session: Awaited<ReturnType<GoogleService["complete"]>>;
    try {
      session = await this.google.complete(state, code, cookie);
    } finally {
      res.clearCookie("ventix_oauth", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: this.env.NODE_ENV === "production",
      });
    }
    res.cookie("ventix_refresh", session.refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: this.env.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, `${this.env.WEB_ORIGIN}/auth/callback?provider=google`);
  }
}
