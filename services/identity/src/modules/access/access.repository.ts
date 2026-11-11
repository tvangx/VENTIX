import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../db/prisma.service";

@Injectable()
export class AccessRepository {
  constructor(private readonly prisma: PrismaService) {}
  user(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        userRoles: { include: { role: true, organizer: { select: { status: true } } } },
      },
    });
  }
}
