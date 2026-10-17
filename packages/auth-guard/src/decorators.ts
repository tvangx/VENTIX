import { SetMetadata, createParamDecorator, ExecutionContext } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import type { Request } from "express";
import type { AuthUser } from "./jwt-verifier";

export const IS_PUBLIC_KEY = "auth:isPublic";
export const ROLES_KEY = "auth:roles";

/** Bỏ qua xác thực cho endpoint này (mặc định mọi endpoint đều yêu cầu JWT). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Yêu cầu có ít nhất MỘT trong các role. */
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

export type RequestWithUser = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) throw new ProblemException("UNAUTHORIZED", 401, "Chưa xác thực");
    return user;
  },
);

/** Kiểm tra tenant: user chỉ được thao tác trên organizer của chính mình. */
export function assertSameOrganizer(user: AuthUser, organizerId: string): void {
  if (!user.organizerId || user.organizerId !== organizerId) {
    throw new ProblemException("TENANT_MISMATCH", 403, "Không có quyền với organizer này");
  }
}
