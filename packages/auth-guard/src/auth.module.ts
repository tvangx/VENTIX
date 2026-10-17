import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard, RolesGuard } from "./guards";
import { JwtVerifier } from "./jwt-verifier";
import { AUTH_OPTIONS, AuthGuardOptions } from "./options";

@Module({})
export class AuthModule {
  /** Đăng ký guard toàn cục: mặc định từ chối, dùng `@Public()` để mở. */
  static register(options: AuthGuardOptions): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: AUTH_OPTIONS, useValue: options },
        JwtVerifier,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
      exports: [JwtVerifier],
    };
  }
}
