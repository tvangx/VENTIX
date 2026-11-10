import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { RequestWithUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";
import { QueueService } from "./queue.service";

@Injectable()
export class AdmissionGuard implements CanActivate {
  constructor(private readonly queue: QueueService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const body = req.body as Record<string, unknown> | undefined;
    const value = req.params.id ?? body?.event_id ?? req.query.event_id;
    const event = z
      .string()
      .uuid()
      .safeParse(typeof value === "string" ? value.toLowerCase() : value);
    if (!event.success) throw new ProblemException("INVALID_INPUT", 400, "event_id must be a UUID");
    if (!req.user) throw new ProblemException("UNAUTHORIZED", 401, "Authentication required");
    await this.queue.authorize(
      event.data,
      req.user.userId.toLowerCase(),
      req.get("X-Admission-Token"),
    );
    return true;
  }
}
