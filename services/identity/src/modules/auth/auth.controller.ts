import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import type { Request, Response } from "express";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { AuthKeys } from "./auth-keys";
import { AccessTokenDto, CredentialsDto, RegisteredUserDto } from "./auth.dto";
import { AuthService } from "./auth.service";
import { JwksDto } from "./auth.responses";

@Public()
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private checkOrigin(req: Request) {
    if (req.headers.origin && req.headers.origin !== this.env.WEB_ORIGIN)
      throw new ProblemException("ORIGIN_FORBIDDEN", 403, "Origin không được phép");
  }
  private cookie(req: Request): string {
    return (
      req.headers.cookie
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("ventix_refresh="))
        ?.slice("ventix_refresh=".length) ?? ""
    );
  }
  private respond(res: Response, result: { access_token: string; refreshToken: string }) {
    res.setHeader("Cache-Control", "no-store");
    res.cookie("ventix_refresh", result.refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: this.env.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    return {
      access_token: result.access_token,
      token_type: "Bearer",
      expires_in: this.env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  @Post("register")
  @ApiOperation({ summary: "Đăng ký email, idempotent theo key" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: RegisteredUserDto })
  register(@Body() dto: CredentialsDto, @Headers("idempotency-key") key?: string) {
    return this.auth.register(dto.email, dto.password, key);
  }

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Đăng nhập, đặt refresh cookie HttpOnly" })
  @ApiOkResponse({
    type: AccessTokenDto,
    headers: {
      "Set-Cookie": {
        description: "ventix_refresh, HttpOnly; SameSite=Lax; Secure ở production",
        schema: { type: "string" },
      },
    },
  })
  async login(
    @Body() dto: CredentialsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.checkOrigin(req);
    return this.respond(res, await this.auth.login(dto.email, dto.password));
  }

  @Post("refresh")
  @ApiCookieAuth()
  @HttpCode(200)
  @ApiOperation({ summary: "Xoay refresh token; reuse thu hồi cả family" })
  @ApiOkResponse({
    type: AccessTokenDto,
    headers: {
      "Set-Cookie": {
        description: "Refresh cookie mới; cookie cũ bị thu hồi",
        schema: { type: "string" },
      },
    },
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.checkOrigin(req);
    try {
      return this.respond(res, await this.auth.refresh(this.cookie(req)));
    } catch (error) {
      res.clearCookie("ventix_refresh", {
        path: "/",
        sameSite: "lax",
        secure: this.env.NODE_ENV === "production",
        httpOnly: true,
      });
      throw error;
    }
  }

  @Post("logout")
  @ApiCookieAuth()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Family bị thu hồi, cookie bị xóa" })
  @ApiOperation({ summary: "Thu hồi cả family, xóa cookie" })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.checkOrigin(req);
    await this.auth.logout(this.cookie(req));
    res.clearCookie("ventix_refresh", {
      path: "/",
      sameSite: "lax",
      secure: this.env.NODE_ENV === "production",
      httpOnly: true,
    });
  }
}

@Public()
@ApiTags("auth")
@Controller(".well-known")
export class JwksController {
  constructor(private readonly keys: AuthKeys) {}
  @Get("jwks.json")
  @ApiOkResponse({ type: JwksDto })
  @ApiOperation({ summary: "Khóa công khai RSA để các service verify JWT" })
  jwks() {
    return this.keys.jwks();
  }
}
