import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { assertSameOrganizer, RequestWithUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { AccessService } from "./access.service";

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) throw new ProblemException("UNAUTHORIZED", 401, "Chưa xác thực");
    const organizerId = req.params.organizerId as string;
    assertSameOrganizer(req.user, organizerId);
    await this.access.tenantRoles(req.user.userId, organizerId);
    return true;
  }
}
