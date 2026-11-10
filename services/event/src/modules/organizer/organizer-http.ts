import { applyDecorators, createParamDecorator, ExecutionContext, Type } from "@nestjs/common";
import {
  ApiExtraModels,
  ApiHeader,
  ApiProperty,
  ApiResponse,
  getSchemaPath,
} from "@nestjs/swagger";
import type { RequestWithUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";

export const OrganizerId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const { user } = context.switchToHttp().getRequest<RequestWithUser>();
  const tenant = z.string().uuid().safeParse(user?.organizerId);
  if (!tenant.success) {
    throw new ProblemException("TENANT_MISMATCH", 403, "Thiếu thông tin Organizer hợp lệ");
  }
  return tenant.data.toLowerCase();
});

class OrganizerProblemResponse {
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: "integer" }) status!: number;
  @ApiProperty() detail!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ type: String, nullable: true }) request_id!: string | null;
}

const problem = {
  "application/problem+json": {
    schema: { $ref: getSchemaPath(OrganizerProblemResponse) },
  },
};

export function ApiOrganizerErrors() {
  return applyDecorators(
    ApiExtraModels(OrganizerProblemResponse),
    ApiResponse({ status: 400, description: "Dữ liệu không hợp lệ", content: problem }),
    ApiResponse({ status: 401, description: "Thiếu token hợp lệ", content: problem }),
    ApiResponse({ status: 403, description: "Thiếu role hoặc tenant hợp lệ", content: problem }),
    ApiResponse({ status: 404, description: "Không tìm thấy trong tenant", content: problem }),
  );
}

export function ApiOrganizerWrite(status: 200 | 201 | 204, type?: Type<unknown>) {
  return applyDecorators(
    ApiHeader({
      name: "Idempotency-Key",
      required: true,
      schema: { type: "string", format: "uuid" },
    }),
    ApiResponse({ status, type }),
    ApiResponse({
      status: 409,
      description: "Trạng thái, phiên bản, khóa ghi hoặc quan hệ bị xung đột",
      content: problem,
    }),
  );
}
