import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ProblemException } from "@ticketing/common";
import { IS_PUBLIC_KEY, RequestWithUser, ROLES_KEY } from "./decorators";
import { JwtVerifier } from "./jwt-verifier";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    const [scheme, token] = typeof header === "string" ? header.split(" ") : [];
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new ProblemException("UNAUTHORIZED", 401, "Thiếu access token");
    }
    req.user = await this.verifier.verify(token);
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user) throw new ProblemException("UNAUTHORIZED", 401, "Chưa xác thực");
    if (!required.some((r) => user.roles.includes(r))) {
      throw new ProblemException("FORBIDDEN", 403, "Không đủ quyền");
    }
    return true;
  }
}
